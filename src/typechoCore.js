let TypechoCore = window.TypechoCore || {};

TypechoCore = {
	/**
	 * 全局初始化状态。
	 * @type boolean
	 */
	initialized: false,

	// 元素驱动注册器映射
	// TODO: 触发元素本身也应当保存
	initRegistry: [],

	// 已通过 proxy 监听的对象
	proxyRegistry: [],

	// 资源根位置
	backendAssetsPath: '',

	// 当前 core 脚本文件的加载域
	kernelOrigin: '',

	// 已完成的动态资源请求池
	resolvedRequests: [],

	/**
	 * 页面 PJAX 容器的 ID。
	 * @type string
	 */
	mainContainerId: 'main',

	// 应用至 jQuery PJAX 的选择器
	pjaxTargetSelectors: [],

	// 是否启用调试模式
	debugMode: false,

	/**
	 * 已被注册的 CAPTCHA 提供商。默认为 reCAPTCHA。
	 * @type { function }
	 */
	captchaProvider: null,

	init: function() {
		if (window.jQuery === undefined) {
			return console.error('jQuery 未加载，请先加载 jQuery。');
		} else if (this.initialized) {
			return console.error('TypechoCore 被重复加载。');
		}

		// 为子对象分配对 Core 的访问引用
		// TODO：临时加的，应该精细化一点
		for (const child in this) {
			if (
				this[child] !== null &&
				typeof this[child] === 'object'
			) {
				this[child]._core = this;
			}
		}

		this.State.init();

		// @eventReg`core:preInit`
		$(document).trigger('core:preInit');

		this.kernelOrigin = this.getScriptOrigin();
		this.backendAssetsPath = this.getRelativePath();

		// 注册基本驱动
		this.registerElement('page-title');
		this.registerElement('captcha');
		this.registerElement('instant-toc');
		this.registerElement('instant-overlay');
		this.registerElement('ajax-submit');

		// 注册 jQuery 扩展方法
		this.registerJQExtends();
		// 动态加载自定义外部资源
		this.engine.postRequireResourceFromDOM();

		// 启用 jQuery LazyLoad
		this.xhr.listen(this.utils.lazyLoad, true);

		// 获取当前页面的 permalink
		this.xhr.listen(this.content.getInfoFromAnywhere, true);

		// 事件查找器应在每次软加载之后均触发一次
		this.xhr.listen(this.elementInit);

		// 添加默认 jQuery PJAX 选择器
		this.utils.addPjaxTarget('a:not(a[target="_blank"])');

		// 启用 PJAX
		$(document).pjax(this.pjaxTargetSelectors.join(", "), {
			timeout:		this.xhr.timeout,
			container:		'#' + this.mainContainerId,
			fragment:		'#' + this.mainContainerId,
		});

		// @eventReg`core:postInit`
		$(document).trigger('core:postInit');
		this.initialized = true;
	},

	/**
	 * 状态变量简易配置函数。
	 *
	 * @param key	State 对象的属性键
	 * @param value	State 对象的对应值
	 * @return {*}
	 */
	state: function(key, value) {
		if (!value) return this.State[key];
		this.State[key] = value;
	},

	/**
	 * 监听指定命名空间中属性的变动。
	 * 用法示例：proxy( TypechoCore.State, 'someProperty', (new) => {...} )
	 * 因能够自动检测复用，故允许重复使用。
	 *
	 * @param { Object }	namespace	命名空间对象
	 * @param { string }	property	此命名空间中的指定属性名
	 * @param { function }	callback	属性发生更改时所要执行的函数
	 * @return {*}
	 */
	proxy: function(namespace, property, callback) {
		const canonicalName = namespace + '.' + property;
		if (
			this.proxyRegistry.includes(canonicalName) ||
			typeof callback !== 'function'
		) {
			return;
		}

		let value = namespace[property];

		Object.defineProperty(namespace, property, {
			get() {
				return value;
			},
			set(newValue) {
				value = newValue;
				callback(newValue);
			},
			enumerable: true,
			configurable: true
		});

		this.proxyRegistry.push(canonicalName);
	},

	/**
	 * 触发一次 TypechoInit 行为。
	 * 当使用 AJAX 时，此函数应与其某些相关事件监听器所绑定。
	 *
	 * TODO: 允许通过 options 读取目标元素的所有 data 属性
	 *
	 * @param name	目标 data-typecho-init 属性值
	 * @param scope	此函数的作用域。若只想要在特定的元素中触发 init，则传递
	 */
	elementInit: function(name, scope) {
		const triggerName = name ? ('=' + name) : '',
			  typechoInitName = '[data-typecho-init' + triggerName + ']';

		const elements =
			(scope && scope.length) ? scope.find(typechoInitName) : $(typechoInitName);

		elements.each(function() {
			if ($(this).data('initialized')) return true;

			const initName = $(this).data('typecho-init') ?? '',
				  eventName = TypechoCore.initRegistry[initName];

			try {
				const eventToDispatch = TypechoCore.Element[eventName];
				if (typeof eventToDispatch == 'function') {
					// 对 initialized 的操作放在前面，这样 eventToDispatch 就能够重新获取其控制权
					$(this).data('initialized', true);

					eventToDispatch($(this));
				}
			} catch (error) {
				console.warn('触发器 ' + initName + ' 出现了内部问题。', error);
			}
		});

		// @eventReg`core:elementReady`
		$(document).trigger('core:elementReady');
	},

	/**
	 * 向 Typecho JavaScript 元素空间中注册一个基本事件。
	 * 此事件应通过携带 data-typecho-init 且属性值正确的 jQ 元素触发。
	 *
	 * @param initTrigger
	 * @param alias
	 * @param triggerOnRegister
	 */
	registerElement: function(initTrigger, alias = null, triggerOnRegister = true) {
		// 对同一元素名称的重复注册检测
		if (this.initRegistry[initTrigger]) {
			console.warn('注册器在 ' + initTrigger + ' 上有声明重复。这不符合注册规范。请检查其明确性。')
		}

		this.initRegistry[initTrigger] = alias ?
			alias : initTrigger.replace(/-([a-z])/g, function (match, group) {
				return group.toUpperCase();
		});

		triggerOnRegister && this.elementInit(initTrigger);
	},

	/**
	 * 提供原始 data-ELEMENT-trigger 名称，查找其是否已于 initRegistry 注册，
	 *
	 * @param { string } triggerName
	 * @returns { boolean }
	 */
	isElementRegistered: function(triggerName) {
		return this.initRegistry.hasOwnProperty(triggerName);
	},

	xhr: {
		/**
		 * 对 jQuery AJAX 函数的简单借用。
		 *
		 * @type function
		 */
		makeRequest: $.ajax,

		/**
		 * 对 jQuery PJAX 函数的简单借用。
		 *
		 * @type function
		 */
		makePopStateRequest: $.pjax,

		// 最后一次 XHR 表单请求获取的响应
		lastFormResponse: null,

		// 最大允许超时
		timeout: 8000,

		/**
		 * 绑定 PJAX 事件的工具方法。
		 * 默认绑定至 pjax:end。详见其对 Lifecycle 的支持：
		 * start ~ popstate ~ beforeReplace ~ end
		 * https://github.com/defunkt/jquery-pjax
		 *
		 * 注意：目标函数上下文会失效。
		 *
		 * @param { string }	eventName 		事件名称（PJAX 域）
		 * @param { function }	callback  		回调函数
		 * @param { boolean }	executeAtOnce	是否应立刻执行一次目标回调
		 */
		listen: function(
			callback,
			executeAtOnce = false,
			eventName = 'end'
		) {
			if (typeof callback !== 'function') return;

			$(document).on(('pjax:' + eventName),
				function() { callback.bind(null)() }
			);

			if (executeAtOnce) callback();
		},

		/**
		 * 绑定单次 PJAX 事件的工具方法。
		 * 将指定的操作绑定至下一次 PJAX 时页面内容执行替换之前。
		 * 通常用于销毁、回收当前页面所创建的实例，以及清洗垃圾元素。
		 *
		 * 注意：目标函数上下文会失效。
		 *
		 * @param { string }	eventName 事件名称（PJAX 域）
		 * @param { function }	callback  回调函数
		 */
		listenOnce: function(
			callback,
			eventName = 'beforeReplace',
		) {
			if (typeof callback !== 'function') return;

			$(document).one('pjax:' + eventName,
				function () { callback.bind(null)() }
			);
		},
	},

	utils: {
		/**
		 * 获取目标元素的 CSS 动画时长。
		 * 若未获取到则返回默认值 0。
		 *
		 * @type { function }
		 */
		getCssTransitionDuration: null,

		/**
		 * 滚动至指定元素位置。
		 * 提供 HTMLElement 或 jQuery 对象均可。
		 *
		 * @param element
		 */
		scrollTo: function (element) {
			if (element instanceof jQuery) element = element[0];

			if (element instanceof HTMLElement) {
				element.scrollIntoView( { behavior: 'smooth', block: 'start', inline: 'nearest' } );
			}
		},

		/**
		 * 因需要从 PJAX 反复触发，故去除上下文。
		 *
		 * @param container		父容器
		 * @param selector		目标图片选择器
		 * @param effect		由 $.lazy 支持的动画效果
		 * @param effectTime	动画持续时间
		 * @param visibleOnly	由 $.lazy 支持的 visibleOnly
		 */
		lazyLoad: function (
			container,
			selector = '.lazy',
			effect = 'fadeIn',
			effectTime = 300,
			visibleOnly = true
		) {
			if (typeof $['lazy'] === 'undefined') return;

			if (container instanceof HTMLElement) {}
			else if (container instanceof jQuery) { container = container[0] }
			else { container = document.getElementById(container ?? TypechoCore.mainContainerId)}

			const placeHolderPath = TypechoCore.kernelOrigin + TypechoCore.backendAssetsPath;

			$(container).find(selector)['Lazy']({
				effect: effect,
				effectTime: effectTime,
				visibleOnly: visibleOnly,
				defaultImage: placeHolderPath + 'loading.svg',

				'afterLoad': function(element) {
					element.addClass('lazy-loaded');
				}
			});
		},

		/**
		 * 绑定一个快捷键行为。
		 *
		 * 对于 needle，其应形为：
		 * (event) => { return (event.ctrlKey || event.metaKey) && event.which === 83 }
		 * 上述表达式表示用户按下 CTRL+S。你应提供这样的布尔表达式来指定键盘条件。
		 *
		 * @param { function }	handler		该快捷键在按下时所出发的行为
		 * @param { function }	needle		触发条件，应为一个或一组标准的按键操作
		 * @param { boolean }	isPermanent 该快捷键是否应永久存在于文档流当中
		 */
		bindKey: function (
			handler,
			needle,
			isPermanent = false
		) {
			if (typeof handler !== 'function' || typeof needle !== 'function') return;

			function keyBindHandler(event) {
				if (needle(event)) {
					event.preventDefault() || handler();
					return false;
				}
			}

			$(document).on('keydown', keyBindHandler);

			if (!isPermanent) {
				this._core.xhr.listenOnce(function() {
					$(document).off('keydown', keyBindHandler);
				})
			}
		},

		/**
		 * 禁用当前页面的历史记录。
		 *
		 * @param { boolean } useRandomToken 为标识唯一性，是否应在 URL 后方追加随机 token。
		 */
		disableHistoryOnce: function (useRandomToken = false) {
			$.pjax.defaults.replace = true;

			if (useRandomToken) {
				const token = Math.floor(Math.random() * 0xffffff).toString(16).padEnd(6, "0");
				window.history.replaceState(null, null,
					window.location.href.split('?')[0] + '?_t=' + token
				);
			}

			$(document).one('core:elementReady',() => {
				$.pjax.defaults.replace = false;
			});
		},

		/**
		 * 添加 PJAX 目标选择器。
		 * 应执行于 core:preInit 事件。
		 *
		 * @param selector
		 */
		addPjaxTarget: function (selector) {
			this._core.pjaxTargetSelectors.push(selector);
		},
	},

	engine: {
		/**
		 * 若一个对象未在我们的 resolvedRequests 池中，则执行 action 操作。
		 *
		 * 所传入的 action 事实上应当为 function(callback) 形式。
		 * 若如此声明操作，则可将操作内部的成功回调隔代返回给 requestNew，从而允许其执行 push。
		 *
		 * @param resourceName 建议规范化的资源名称
		 * @param action 回调操作
		 */
		requestNew: function (resourceName, action) {
			typeof action === 'function' && action((resolve) => {
				resolve && resolve();
				this._core.resolvedRequests.push(resourceName);
			}, this._core.resolvedRequests.includes(resourceName));
		},

		/**
		 * 动态请求联机资源。
		 * 传入 JS/CSS 文件相对本地路径或联机路径的字符串或其数组，
		 * 然后此函数按照它们的既定顺序依次发起请求。在上一个元素 onload/done 之前，不会继续。
		 *
		 * 对目标函数使用 async 声明，然后在适当位置 await 该 Promise 方法，
		 * 则在所有传入参数对应的资源完成请求之前，目标函数的后续操作不会执行。
		 *
		 * 在执行 Element 事件函数的声明时，请注意此方法在其它事件绑定操作中匿名函数的用法。
		 * 无论使用 then 还是 await 关键字，requestResource 所在的绑定器均应为事件函数声明的最后一个操作。
		 * 此方法所在绑定器代码段的后续操作将不会执行。同时，若确实存在这些操作，则 Core 会认为该事件函数尚未注册。
		 * 事件函数事实上确实已被注册，且能够正常触发。
		 *
		 * @requires requestNew
		 * @param { string|Array } $source 资源名字符串或其数组
		 * @returns {Promise<void>}
		 */
		requestResource: async function ($source) {
			// @eventReg`core:promisedLoadStart`
			$(document).trigger('core:promisedLoadStart');

			if (!Array.isArray($source)) $source = [$source];

			for (const url of $source) {
				if (!url || url === '') continue;

				const resource = url.split('/').pop().split('?')[0];

				await new Promise((resolve, _reject) => {
					this._core.engine.requestNew(resource, function(callback, loaded) {
						if (loaded) {
							resolve();
						} else if (resource.endsWith(".js")) {
							$.getScript(url).done(function() { callback(resolve) });
						} else if (resource.endsWith(".css")) {
							const linkEl = $('<link>').prop("href", url)
								.prop("type", "text/css")
								.prop("rel", "stylesheet")
								.on("load", function() { callback(resolve) });
							$('head').append(linkEl);
						}
					});
				});
			}

			// @eventReg`core:promisedLoadStart`
			$(document).trigger('core:promisedLoadStart');
		},

		/**
		 * 检查给定资源（简单名称）是否已成功请求。
		 *
		 * @param { string } resourceName
		 * @returns { boolean }
		 */
		isResolved: function (resourceName) {
			return this._core.resolvedRequests.includes(resourceName);
		},

		/**
		 * 此函数允许页面提供者通过手动为任意元素声明 data-require 属性，
		 * 值为目标资源 URL 的、手动触发 JS/CSS 动态加载的逻辑。
		 */
		postRequireResourceFromDOM: () => {
			const requestStarter = $('[data-require]');

			requestStarter.each(function() {
				const src = $(this).data('require');
				TypechoCore.engine.requestResource(src).then();
			});
		},

		/**
		 * 处理来自服务器的 JSON 响应。
		 *
		 * 携带 message 则闪烁此通知；
		 * 携带 redirect 则重定向至目标位置，同时销毁遮罩层；
		 * action = goBack：执行一次硬后退；
		 * action = tough：执行一次硬刷新；
		 * 若同时提供 message，则在 flashMessage 后再刷新。允许通过提供 delay（ms）来设置延时。
		 * action = refresh：执行一次软刷新；
		 *
		 * TODO: 对于抛出的 Exception 应能够正常接收并对其进行通知
		 *
		 * @requires instantRedirect
		 * @requires flashMessage
		 *
		 * @param { Object } response JavaScript JSON 对象
		 */
		handleServerResponse: function (response) {
			const defaultDelay = 2000,
				  messageToFlash = response.message;

			this._core.xhr.lastFormResponse = response;
			if (messageToFlash) this._core.ui.flashMessage(messageToFlash, defaultDelay);

			function toughRedirectAfterDelay(redirect, milliSeconds = 2000) {
				function reloadPage() {
					redirect ? (location.href = redirect) : location.reload();
				}

				if (messageToFlash) {
					setTimeout(reloadPage, milliSeconds);
				} else {
					reloadPage();
				}
			}

			if (response.action !== null) {
				const redirect = response.redirect;

				switch (response.action) {
					case 'goBack':	window.history.go(-1);							break;
					case 'refresh':	this._core.engine.instantRedirect();					break;
					case 'tough':	toughRedirectAfterDelay(redirect, response['delay']);	break;
				}
			}

			if (response.redirect) {
				this._core.engine.instantRedirect(response.redirect);
			}

			// @eventReg`core:xhrPositive`
			// @eventReg`core:xhrNegative`
			$(document).trigger(response.success ? 'core:xhrPositive' : 'core:xhrNegative');
		},

		/**
		 * 软重定向当前页面。
		 *
		 * @scope CORE
		 * @param { string|null } location	目标 URL，不提供则默认为刷新
		 * @param { string|null } container 以 PJAX 重载时所提供的目标容器选择器
		 */
		instantRedirect: function (
			location = null,
			container = null
		) {
			const target = location ?? window.location.href;

			// 给服务器留点反应时间
			let duration = 325;

			// 若存在遮罩层，则等待 Overlay 完全撤销后再执行刷新
			const overlay = this._core.ui.overlay;
			if (overlay) {
				duration = this._core.utils.getCssTransitionDuration(overlay);
				this._core.ui.destoryOverlay();
			}

			setTimeout(() => {
				$.pjax({
					url:		target,
					container:	container ?? ('#' + this._core.mainContainerId),
					timeout:	this._core.xhr.timeout,
					fragment:	container ?? ('#' + this._core.mainContainerId),
				});
			}, duration);
		},
	},

	ui: {
		/**
		 * 页面的遮罩容器，显然只能存在一个。
		 * @type HTMLElement
		 */
		overlay: null,

		/**
		 * 闪烁一次通知。
		 * 通知将被盛放在 flashMessage 容器中，并伴有 is-active 状态。
		 *
		 * @param { string }	message 消息正文内容
		 * @param { number }	timeout 通知持续时间
		 * @param { function }	onClose 关闭时的行为
		 */
		flashMessage: function (
			message,
			timeout = 1250,
			onClose = null
		) {
			const $message = $('<div class="flashMessage"><div class="flashMessage-content"></div></div>');
			$message.find('.flashMessage-content').html(message);

			$message.appendTo('body');
			$message.addClassTransitioned('is-active');

			setTimeout(function () {
				$message.removeClassTransitioned('is-active', function () {
					$message.remove();
					if (onClose) onClose();
				});
			}, Math.max(500, timeout));
		},

		/**
		 * 向目标元素中动态插入一段 HTML 内容。
		 *
		 * @param container			目标容器的 jQuery 对象或原生 HTML 选择器
		 * @param content			被插入元素 jQuery 对象或原生 HTML 选择器
		 * @param offset			为 -1 则插入至容器前方，0 插入至容器内前方，其它则插入容器内后方
		 * @param scroll			此选项为 true 则在插入后执行一次滚动
		 * @param appendClass		在插入后为目标元素添加的类名
		 * @param animateDuration	目标元素高度由 0 变化为原始值的动画时间
		 * @param easing			动画名称，应严格对应上下文 jQExtends 中对 Easing 的扩展
		 * @param onReady			插入完成后所执行的回调
		 */
		setupHtmlInsert: function (
			container,
			content,
			offset,
			scroll = false,
			appendClass = '',
			animateDuration = 280,
			easing = 'easeOutCubic',
			onReady
		) {
			const insert = content instanceof jQuery ? content : $(content),
				  target = container instanceof jQuery ? container : $(container);

			switch (offset) {
				case -1 : target.before(insert);	break;
				case 0  : target.prepend(insert);	break;
				default : target.append(insert);	break;
			}

			// 处理自动滚动
			scroll && insert[0].scrollIntoView();

			// 获取所插入元素的真高度
			const naturalHeight = insert.outerHeight(true);

			// 在溢出截断边缘上的溢出内容会被截断
			// 距元素内边距框指定宽度 overflow-clip-margin 范围内的内容溢出
			insert
				.css('max-height', 0)
				.css('overflow-y', 'clip')
				.animate( { maxHeight: naturalHeight }, animateDuration, easing )
				.addClass(appendClass);

			// 动画结束后回收变更属性以防止后续可能的插入发生错位（留出 10ms 内部裕量）
			setTimeout(function() {
				insert.
				css('max-height', 'unset').
				css('overflow', 'inherit');
			}, animateDuration + 10);

			// 为所插入的元素重新分配初始化
			this._core.elementInit(null, insert);

			typeof onReady === "function" && onReady();
			return insert;
		},

		/**
		 * 获取指定内容的 Overlay 结构。
		 * 若传入的 content 参数不符合要求则报错。
		 *
		 * @param content		以字符串或 jQuery 对象提供的 HTML 结构
		 * @param title			遮罩层对话窗口的标题
		 * @param overlayClass	最上层 overlay（非容器）的额外类名
		 * @returns {*|jQuery|HTMLElement}
		 */
		getOverlayHtml: function (content, title, overlayClass = '') {
			let $html;

			if (typeof content == 'string') {
				$html = $($.parseHTML(content));
			} else if (content instanceof $) {
				$html = content;
			} else {
				throw new Error('只能使用作为字符串或 jQuery 对象提供的 HTML 创建 Overlay。');
			}

			if (!$html.is('.overlay')) {
				if (!title) {
					const $header = $html.find('.overlay-title');
					if ($header.length) {
						title = $header.contents();
						$header.remove();
					}
				}

				!title && (title = $('title').text());

				const $bodyInsert = $html.find('.overlay-content');
				$bodyInsert.length && ($html = $bodyInsert);

				const $overlay = $(
					'<div class="overlay" tabindex="-1">' +
					'<div class="overlay-title"></div>' +
					'<div class="overlay-content"></div>' +
					'</div>'
				);
				const $title = $overlay.find('.overlay-title');

				$title.html(title);
				$overlay.find('.overlay-content').html($html);

				$html = $overlay.addClass(overlayClass);
			}

			$html.appendTo('body');
			return $html;
		},

		/**
		 * 在页面中创建一个模态对话框。
		 * 单击非窗口部分将会关闭并销毁所有创建的内容。
		 *
		 * @param content
		 * @param dismissible
		 */
		createOverlay: function(content, dismissible = true) {
			let $container = $('<div class="overlay-container" />').html(content);

			$container.on('mousedown', function (e) {
				const self = $(this);
				self.data('block-close', false);

				// 单击未指向容器，阻止关闭
				!$(e.target).is(self) && self.data('block-close', true);
			});

			$container.on('click', function (e) {
				const self = $(this);

				if ($(e.target).is(self) && dismissible) {
					if (!self.data('block-close')) TypechoCore.ui.destoryOverlay();
				}

				self.data('block-close', false);
			});

			$('body').addClass('is-modalOpen');
			$container.appendTo('body').addClassTransitioned('is-active');

			this.overlay = $container;
		},

		/**
		 * 销毁当前页面的模态层及其所有内容。
		 */
		destoryOverlay: function() {
			const overlay = this.overlay;
			if (overlay) {
				overlay.removeClassTransitioned('is-active', function () {
					$('body').removeClass('is-modalOpen');
					overlay.remove();
				});
			}

			this.overlay = null;
		},

		/**
		 * 显示一个用户可选择的对话框。
		 * 使用 await 或 then 来实现此强制用户与对话框进行交互的向后阻塞。
		 *
		 * @param { string }		title		标题文本
		 * @param { string|Object }	content		正文内容
		 * @param { Object[] }		buttons		下方按钮
		 * @param { boolean }		dismissible	是否可通过点击其它位置避免选择此对话框
		 */
		dialog: function(
			title,
			content,
			buttons,
			dismissible = true
		) {
			return new Promise((resolve, _reject) => {
				const message	= $('<div class="p-dialog--message"></div>'),
					  action	= $('<div class="p-dialog--action"></div>');

				$.each(buttons, function (index, button) {
					if (typeof button["destoryOnClick"] === 'undefined') {
						button["destoryOnClick"] = true;
					}

					if (!button.type || typeof button.type === 'undefined') {
						button.type = 'default'
					}

					const $button = $('<button></button>')
						.text(button.text)
						.on('click', () => {
							const callbackFunction = button.callback;
							if (typeof callbackFunction == 'function') callbackFunction();

							button["destoryOnClick"] && TypechoCore.ui.destoryOverlay();
							resolve(button);
						})
						.addClass('p-button p-button--' + button.type);

					action.append($button);
				});

				message.html(content);

				const overlayHtml = this.getOverlayHtml(message.add(action), title, 'overlay-dialog');
				this.createOverlay(overlayHtml, dismissible);
			});
		},

		/**
		 * 将某个元素的显示状态与单个控件绑定。
		 * 此函数是基于已固化的 CSS 类名工作的。
		 *
		 * @param $trigger			触发控件元素的 jQuery 对象
		 * @param $target			目标元素（容器）的 jQuery 对象
		 * @param hiddenClassName	已为其声明 CSS 隐藏型规则的类名
		 */
		switchable: function(
			$trigger,
			$target,
			hiddenClassName = 'u-hidden'
		) {
			$trigger.on('click', function(event) {
				$target.toggleClass(hiddenClassName);
				event.stopPropagation();
			});

			/**
			 * 单击事件目标对象判断器。
			 * 函数化以便为 document 回收此单击侦听。
			 */
			const collectableClickEvent = (event) => {
				if (
					!$target.is(event.target) && !$trigger.is(event.target) &&
					$target.has(event.target).length === 0
				) {
					$target.addClass(hiddenClassName);
				}
			}

			$(document).on('click', collectableClickEvent);

			// 页面发生变动即为 document 回收此单击侦听器
			TypechoCore.xhr.listenOnce(function() {
				$(document).off('click', collectableClickEvent);
			});
		},
	},

	storage: {
		/**
		 * 在 LocalStorage 中操作数组的实用方法。
		 *
		 * @return { Array | void }
		 */
		localStorageArray: function(key, value = null) {
			let record = JSON.parse(localStorage.getItem(key));
			if (!value) return record;

			if (!record) record = [];
			record.push(value);

			localStorage.setItem(key, JSON.stringify(record));
		},

		/**
		 * 判断 LocalStorage 中指定存储键的数组中是否存在某个值。
		 *
		 * @return { boolean }
		 */
		localStorageArrayExists: function(key, value) {
			/** @type array */
			const record = this.localStorageArray(key);
			return record && record.includes(value);
		},
	},

	content: {
		// 适配 Typecho 惯例，当前页面的内容 ID
		id: null,

		/**
		 * 适配 Typecho 惯例，当前页面的正文区域 ID。
		 * @type string
		 */
		areaId: 'contentArea',

		// 此属性应为原始页面正文的 HTML 内容
		html: null,

		// 适配 Typecho 惯例，当前页面的真实链接
		permalink: '',

		/**
		 * 此方法不会在原生 tpCore 中执行，它应当被负责处理 contentArea 的函数执行。
		 * 因 tpCore 只能确保在第一次 DOM 得到硬加载时正确获取内容，其余情况下，
		 * 若页面正文是通过 AJAX 请求获取，则可能出现 contentArea 处理者先执行、此函数后执行的情况。
		 * 在这种情况下，不能够确保获取的是未经处理的原始文章内容。
		 *
		 * 对上下文不敏感。
		 *
		 * @param { string|null } id 正文区域的 HTMLElement.id
		 */
		registerArea: function(id = null) {
			if (!id) {
				id = TypechoCore.content.areaId;
			} else {
				TypechoCore.content.areaId = id;
			}

			const contentArea = document.getElementById(id);
			TypechoCore.content.html = contentArea ? contentArea.innerHTML : null;
		},

		/**
		 * 若存在携带 permalink 的元素，则记录 permalink。
		 */
		getInfoFromAnywhere: function() {
			const permalinkCarrier = document.querySelector('[data-permalink]'),
				  contentId = document.querySelector('[data-cid]');

			TypechoCore.content.id = contentId ? contentId.dataset.cid : null;
			TypechoCore.content.permalink = permalinkCarrier ? permalinkCarrier.dataset.permalink : null;
		},
	},

	registerJQExtends: function() {
		/**
		 * 获取目标元素的 CSS 动画时长。
		 * 若未获取到则返回默认值 0。
		 *
		 * @param { Object } $element
		 * @returns { number }
		 */
		function getCssTransitionDuration($element) {
			const el = $element[0];
			if (!el || !(el instanceof window.Element)) return 0;

			let durationCss = $element.css('transition-duration'),
				duration = 0;

			if (durationCss) {
				const durationRegex = /^(\+|-|)([0-9]*\.[0-9]+|[0-9]+)(ms|s)$/i;
				const match = durationCss.match(durationRegex);

				if (match) {
					const sign = match[1] === '-' ? -1 : 1;
					const value = parseFloat(match[2]);
					const unit = match[3].toLowerCase() === 'ms' ? 1 : 1000;
					duration = sign * value * unit;
				}
			}

			return duration;
		}

		// 还是注册一下吧，要不然白瞎了
		this.utils.getCssTransitionDuration = getCssTransitionDuration;

		$.fn.addClassTransitioned = function (className, onTransitionEnd) {
			const $element = $(this),
				  duration = getCssTransitionDuration($element);

			setTimeout(function () {
				$element.addClass(className);
			}, 16.5);

			if (typeof onTransitionEnd == 'function') {
				setTimeout(onTransitionEnd, 16.5 + duration);
			}
			return this;
		};

		$.fn.removeClassTransitioned = function (className, onTransitionEnd) {
			const duration = getCssTransitionDuration($(this));

			$(this).removeClass(className);

			if (typeof onTransitionEnd == 'function') {
				setTimeout(onTransitionEnd, duration);
			}
			return this;
		};

		$.fn.classTo = function(classToRemove, classToAdd) {
			$(this).removeClass(classToRemove).addClass(classToAdd);
		}

		/**
		 * 注册几个我最爱的基本缓动函数。
		 *
		 * @see https://easings.net
		 */
		$.extend( $.easing, {
			def: 'easeOutQuad',
			'easeOutCubic': function (x) { return 1 - Math.pow( 1 - x, 3 ) },
			'easeOutQuart': function (x) { return 1 - Math.pow( 1 - x, 4 ) }
		});
	},

	/**
	 * 获取当前脚本（或指定位置）的运行目录。
	 *
	 * @param canonical
	 * @returns {string}
	 */
	getRelativePath: function(canonical = null) {
		const currentScriptPath = canonical ?? document.currentScript.src,
			  pathUrlObject = new URL(currentScriptPath),
			  relativePath = pathUrlObject.pathname,
			  fileName = currentScriptPath.substring(currentScriptPath.lastIndexOf("/") + 1);

		return relativePath.replace(fileName, '');
	},

	getScriptOrigin: function() {
		const scriptSrc = new URL(document.currentScript.src);
		return scriptSrc.origin;
	},

	Processor:	{},
	Callback:	{},

	State: {
		/**
		 * 标识当前页面主体是通过何种方式获取的。
		 * 因用户可能通过（AJAX）单击、前进后退以及硬加载这四种方式来到此页面。
		 * 分别以 click、popstate 与 browser 表示。
		 */
		loadedFrom: 'browser',

		init: function() {
			// 若发生 XHR.click，则显然所加载的页面是通过单击方式以 XHR 请求的
			TypechoCore.xhr.listen(() => {
				TypechoCore.State.loadedFrom = 'xhrClick';
			}, false, 'click');

			// 使用 PJAX 提供的 popstate 而非 window.popstate
			// https://stackoverflow.org.cn/questions/10756893
			TypechoCore.xhr.listen(() => {
				TypechoCore.State.loadedFrom = 'popstate';
			}, false, 'popstate');
		},

		/**
		 * 判断当前页面的内容区域是否是来自指定源。
		 *
		 * @param { string|null } source 接受 xhrClick、popstate 以及 browser
		 * @return { string|boolean }
		 */
		'isLoadedForm': function(source = null) {
			if (!source) {
				return this.loadedFrom;
			} else {
				return this.loadedFrom === source;
			}
		},
	},

	Element: {
		/**
		 * 允许元素触发器修改页面标题。
		 *
		 * @param $heading
		 */
		pageTitle: function($heading) {
			document.title = $heading.text();
		},

		/**
		 * 令当前 TOC 结构中的带 ANCHOR 元素随页面 URL 同步高亮。
		 *
		 * @param $holder 执行 TypechoInit 的 jQuery 对象
		 */
		'instantToc': function($holder) {
			const selector = $holder.data('selector') ?? 'toc-list';

			holderInit(selector);

			/**
			 * 刷新选项卡容器内部元素的显示状态。
			 * 使用原生 JavaScript 以规避类名操作失效的问题。
			 *
			 * @param selectors
			 */
			function holderInit(selectors) {
				const holder = document.querySelector(selectors ? ('.' + selectors) : '.toc-list');

				if (holder) {
					const linkTargets = holder.querySelectorAll('a'),
						  currentUrl = window.location.href;

					linkTargets.forEach(function(link) {
						if (link.href === currentUrl) {
							link.classList.add('is-active');
							link.parentNode['classList'].add('is-active-li');
						} else {
							link.classList.remove('is-active');
							link.parentNode['classList'].remove('is-active-li');
						}
					});
				}
			}
		},

		/**
		 * 将当前表单注册为 AJAX 提交。
		 * 允许使用 HTML $SubmitButton 或 $AnchorElement。
		 *
		 * 使用 rel 或 href 属性时，其值会作为提交 URL。
		 * 若按钮提供了 name，则会在提交时一并将此 name 及其值拼接到查询字符串中。
		 * data-raw，为 true 则不再期望返回 JSON，而是以 PJAX 方式重新为页面加载服务器返回的内容。
		 * data-auto-flush：在提交完成后软刷新一次页面。
		 * data-preprocess：按钮单击后、请求提交前所调用的方法，其应在 Element.Processor 中指定。
		 * data-callback：在服务器完成返回响应之后执行一次 Element.Callback 空间下指定名称的回调.
		 *
		 * @param $submit
		 */
		'ajaxSubmit': function($submit) {
			/**
			 * 表单一旦包含携带 ajax-submit 的 submitter，则它的提交事件只接受这些 submitter 的触发，
			 * 而那些只携带 type 为 submit 的 input 或 button，它们的单击也会触发 submit 事件，但随即便会被拒绝。
			 * 显然你可以手动将一些元素的 trustedSubmitter 状态设置为 true，不过不是很推荐。（会是在什么情况下才需要这么做呢？...）
			 */
			$submit.data('trustedSubmitter', true);

			let $form = $submit.closest('form'),
				action = $form.attr('action') ?? window.location.href;

			const method			= $form.attr('method'),
				  htmlResponse		= $submit.data('html-response'),
				  rel				= $submit.attr('rel'),
			  	  submitName		= $submit.attr('name'),
				  submitCallback	= $submit.data('callback'),
				  preProcessMethod	= $submit.data('preprocess'),
			  	  submitValue		= $submit.attr('value');

			if (submitName) {
				action += (action.indexOf('?') !== -1 ? '&' : '?') + submitName + '=' + submitValue;
			} else if ($submit.attr('href')) {
				action = $submit.attr('href');
			}

			rel && (action = rel);

			/**
			 * 对应 jQuery.ajax() 在 success 时的回调。
			 * 显式使用 submitCallback 时，将服务器 response 与原始 $form 数据（均已对象化）作为形参传入目标方法。
			 *
			 * 默认使用 handleServerResponse 来处理 JSON 格式的数据。
			 * 若响应为字符串，则约定其为 HTML。始祖 Element 显式声明 data-html-response 时，
			 * 软重定向至原本表单的实际（即带查询字符串的）action URL，否则仅重定向至 action 的属性说明值。
			 *
			 * @requires TypechoCore.engine.handleServerResponse
			 */
			function successCallback(response) {
				if (typeof response === 'string') {
					const target = htmlResponse ?
						(action + '?' + $submit.closest('form').serialize()) : action;
					TypechoCore.engine.instantRedirect(target);
					return;
				}

				if (submitCallback) {
					try {
						TypechoCore.Callback[submitCallback](response, getNonceFormData($form));
					} catch ( error ) {
						console.warn('XHR 表单提交回调 ' + submitCallback + ' 出现错误。', error);
					}
				}

				TypechoCore.engine.handleServerResponse(response);
			}

			/**
			 * 获取表单数据的对象形式。
			 * 直接将整个表单的 jQ 元素对象作为形参，则可得到此表单的内容对象。
			 */
			function getNonceFormData($form) {
				const formData = $form.serializeArray();

				/** @type Object */
				let result = {};
				$.each(formData, function (index, value) {
					result[value.name] = value.value;
				});

				return result;
			}
			this['getNonceFormData'] = getNonceFormData;

			/**
			 * 处理提交操作。
			 * 先检查是否提供了 preProcessMethod 调用。
			 * 若显式提供了预处理方法名称，则将 jQ Form 对象直接传入目标方法。
			 * 方法应同样返回一个 jQ Form 对象。
			 */
			function actionSubmit() {
				let $form = $submit.closest('form');

				if (preProcessMethod) {
					try {
						$form = TypechoCore.Processor[preProcessMethod]($form);
					} catch ( error ) {
						$form = $submit.closest('form');
						console.warn('XHR 表单提交的预处理行为 ' + preProcessMethod + ' 出现错误。', error);
					}
				}

				TypechoCore.xhr.makeRequest({
					url: action, type: method, data: $form.serialize(),
					success: (response) => { successCallback(response) },
					error: function(xhr, status, error) {
						console.error('服务器未能返回预期数据。', status, error);
					}
				});
			}

			// 此处禁止对 $form 直接使用 trigger
			$submit.on('click', function (e) {
				e.preventDefault();
				actionSubmit();
			});

			$form.on('submit', function (e) {
				e.preventDefault();

				// 通过 activeElement 获取 submit 事件的单击触发者，对于非可信提交请求，拒绝
				const triggerElement = document.activeElement;
				if (
					triggerElement &&
					!$(triggerElement).data('trustedSubmitter')
				) {
					console.warn('表单中有元素尝试触发提交，但被拒绝了。' , triggerElement);
					return false;
				}

				actionSubmit();
			});
		},

		/**
		 * 为当前 a 标签注册一个模态对话框。
		 * 这将允许该标签在被单击时动态请求目标内容，这些内容将会在打开的对话框中显示。
		 *
		 * 若目标内容包含表单，则可能需要使用 data-secure 属性来兼容 Typecho 的内部安全策略。
		 * 若将此属性声明为 true，则由 Typecho 返回的安全表单链接生成策略将会变更。
		 * 上述逻辑实际上是通过添加请求参数 proxy = true 来实现。
		 *
		 * 为 a 标签声明 data-fragment 属性时，类似 AJAX 地，将只在返回的 HTML 中截取该 fragment。
		 * 标签的 title 属性将作为目标对话框标题栏中的文本显示。
		 *
		 * @param $anchor
		 */
		'instantOverlay': function($anchor) {
			const href		= $anchor.attr('href'),
				  fragment	= $anchor.data('fragment'),
				  secure	= $anchor.data('secure'),
				  autoClose = $anchor.data('auto-close'),
				  title		= $anchor.attr('title');

			if (!href) return;

			$anchor.on('click', function(e) {
				e.preventDefault();
				e.stopPropagation();

				$.get(href, { 'proxy': !!secure }, function(data) {
					// TODO: 此处选择器逻辑应改进
					data = $('<div>').append(data).find(fragment ?? 'form');

					const overlay = TypechoCore.ui.getOverlayHtml(data, title);
					TypechoCore.ui.createOverlay(overlay);
					autoClose && $(document).one('core:xhrPositive', () => { TypechoCore.ui.destoryOverlay() });

					// 为新打开的对话窗口重新分配初始化
					TypechoCore.elementInit(null, overlay);
				});
			});
		},

		/**
		 * 允许通过 data-typecho-init 来为当前页面注册
		 *
		 * @param $element
		 */
		captcha: function($element) {
			const provider = $element.data('provider') ?? 'grecaptcha';

			let providerObject;

			providerObject = window[provider];
			this.captchaProvider = providerObject;

			function captchaReset() {
				providerObject.reset();
			}

			// 一旦从服务器返回 !success 信息，就重置 captcha 状态
			$(document).on('core:xhrNegative', null, null, captchaReset);

			TypechoCore.xhr.listenOnce(function() {
				$(document).off('core:xhrNegative', null, captchaReset)
			}, 'click');
		}
	},
}

TypechoCore.init();