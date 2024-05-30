!function ($, window, document) {
	// 当前 Script 的运行根。一定要在初始化时就捕获！
	const citizenCoreSrc =  new URL(document.currentScript.src),
		  currentOrigin = citizenCoreSrc.origin,
		  relativePath = TypechoCore.getRelativePath();

	const resourceRoot = currentOrigin + relativePath;
	TypechoCore.state('citizenRoot', resourceRoot);

	// 为搜索栏绑定键盘按键 [/]
	TypechoCore.utils.bindKey(function() {
		document.getElementById('p-search--checkbox').click();
	}, (event) => {
		const activeTag = document.activeElement.tagName,
			  prevents = ['INPUT', 'DIV', 'TEXTAREA', 'SELECT'];

		return (
			!prevents.includes(activeTag) &&
			event.which === 191
		)
	}, true);

	/**
	 * 动态加载器图标及其资源。若你需要自定义此加载器 icon，则应修改 assetRoot 为其它位置
	 *
	 * @param $indicator
	 */
	TypechoCore.Element.loaderIndicator = function ($indicator) {
		const assetRoot = 'https://registry.npmmirror.com/typecho-core/latest/files/use-cases-citizen/spinners/',
			  icon = $indicator.data('icon') ?? 'switcher';

		$indicator.css('background-image', 'url(' + assetRoot + icon + '.svg)');
		icon.endsWith('no_animation') && $indicator.css('animation', 'none');

		TypechoCore.xhr.listen( () => { $indicator.fadeOut(300) } );
		TypechoCore.xhr.listen( () => { $indicator.fadeIn(100)  }, false, 'send');
	}

	/**
	 * 启用明暗切换支持，所绑定的对象应为按钮类元素。
	 * 未声明 data-class-name 时的默认暗色主题类名为 skin-dark。
	 *
	 * @param $control
	 */
	TypechoCore.Element.themeSwitch = function($control) {
		/**
		 * 此函数用于判断浏览器 Storage 服务的可用性。
		 *
		 * @param type
		 * @returns {boolean}
		 */
		function storageAvailable( type ) {
			let storage;

			try {
				storage = window[ type ];
				const x = '__storage_test__';
				storage.setItem( x, x );
				storage.removeItem( x );
				return true;
			} catch ( /** @type {Error} */ e ) {
				// noinspection JSDeprecatedSymbols
				return e instanceof DOMException && (
						e.code === 22 ||
						e.code === 1014 ||
						e.name === 'QuotaExceededError' ||
						e.name === 'NS_ERROR_DOM_QUOTA_REACHED' ) &&
					( storage && storage.length !== 0 );
			}
		}

		if (!storageAvailable('localStorage')) {
			return console.warn('LocalStorage 不可用，明暗切换功能将会失效。')
		}

		const htmlObject = $('html');

		$control.click(function() {
			// @eventReg`citizen:themeSwitched`
			$(document).trigger('citizen:themeSwitched');

			htmlObject.toggleClass('skin-dark');

			const hasDarkSkin = $('html').hasClass('skin-dark');
			localStorage.setItem('citizenTheme', hasDarkSkin ? 'dark' : 'light');
		});
	}

	/**
	 * 为页面的动态切换添加动画效果。
	 *
	 * 显式使用 data-fade-up 时，将对 p-body-container 下的各种元素分别应用上滑渐进。
	 * 上述所有元素是被 Citizen 硬编码的，不应修改其主要类名。
	 *
	 * 不使用 fade-up 时，尝试查找触发器元素所声明的 data-class-in 与 class-out
	 * 作为类名。页面发生切换时，先为其应用消失类名，然后再应用显示类名，以实现切换效果。
	 *
	 * 两种状态下的类名及其动画效果应预先在 CSS 中声明。
	 *
	 * @param $container
	 */
	TypechoCore.Element.animateIn = function($container) {
		$container.data('initialized', false);

		let smoothInClass = $container.data('class-in') ?? 'u-smoothIn',
			smoothOutClass = $container.data('class-out') ?? 'u-smoothOut';

		const animationReady = $container.data('animation-ready');

		if ($container.data('fade-up')) {
			if (!animationReady) {
				enableAnimation();
			} else {
				$container
					.children('.p-body-container')
					.children('.p-grid, .p-body-header, .p-content, .p-section, .p-body-footer, .p-comment')
					.addClass('u-fadeUp');
			}

			return;
		}

		function disableAnimation() {
			$container.data('animation-ready', false);
		}

		function enableAnimation(className) {
			$container
				.addClass(className)
				.data('animation-ready', true);
		}

		// 此变量用于保存清理残留类名的 setTimeout 任务的 ID
		let smoothTimeout;

		/**
		 * 使用 PROXY 监听 TypechoCore.State.loadedFrom 以获取触发当前页面加载的源。
		 * 也可以直接使用 State.loadedFrom，但可能会导致性能问题。
		 *
		 * 通过所获取的源来决定应使用哪一种动画策略，或是不触发动画。
		 */
		TypechoCore.proxy(TypechoCore.State, 'loadedFrom', (source) => {
			switch (source) {
				default: disableAnimation(); break;

				case 'xhrClick': enableAnimation(smoothOutClass); break;
				case 'popstate': enableAnimation(smoothInClass + ' reverse'); break;
			}
		} );

		if (!animationReady) return;

		if ($container.hasClass('reverse')) {
			[smoothInClass, smoothOutClass] = [smoothOutClass, smoothInClass];
		}

		$container.classTo(smoothOutClass, smoothInClass);

		// 短暂延迟后移除动画类名，给浏览器喘息时间！！！
		smoothTimeout = setTimeout(function() {
			$container.removeClass(smoothInClass).removeClass('reverse');
		}, 200);

		// 优化性能表现
		function clearTimeOut() { clearTimeout(smoothTimeout) }

		TypechoCore.xhr.listenOnce(clearTimeOut, 'click');
		TypechoCore.xhr.listenOnce(clearTimeOut, 'popstate');
	}

	/**
	 * 注意，在 Typecho 中，此触发器应只对应于 post 类型。
	 * 对于单独的页面，其不应携带 content-area 特性，以尽可能保留原始内容。
	 *
	 * 处理原始 HTML 以使其能够完美呈现给访问者。
	 *
	 * @param $mainContent 实际上对应 p-content 正文区域
	 */
	TypechoCore.Element.contentArea = function($mainContent) {
		/** @type Object */
		const tpCore = TypechoCore,
			  elCore = tpCore.Element;

		tpCore.content.registerArea();

		const contentElement = $(TypechoCore.content.html),
			  imagePlaceholder = resourceRoot + 'icons/loading.svg';

		// 此部分可以在渲染之前执行替换处理
		// 将正文图片替换为 lazyLoad 与 Fancybox 有效元素，但忽略自带链接的图片
		contentElement.find('img').each(function() {
			const image = $(this);

			if (
				!image.attr('alt') ||
				image.parent().prop('nodeName') === 'A'
			) return true;

			const source = image.attr('src');

			image.attr('src', imagePlaceholder)
				 .attr('data-src', source)
				 .addClass('lazy');

			// 封装 Fancybox 有效标签
			image.wrap('<a href="' + source + '" data-lightbox></a>');
		});

		$mainContent.html(contentElement);

		// 必须在渲染之后执行替换
		// 处理标题。为其添加 ID 以便 TOC 识别
		$mainContent.find('h2, h3').each(function() {
			const titleText = $(this).text();
			$(this).attr('id', titleText);
		});

		// 另外处理正文的图片延迟加载
		tpCore.utils.lazyLoad(tpCore.content.areaId, 'img');

		// 处理目录生成。只允许通过 data-toc 来显式标识目录生成目标容器
		elCore.toc($mainContent);

		// 处理正文图片的灯箱查看绑定
		elCore.fancybox($mainContent);

		// 处理代码高亮
		elCore.prismJS($mainContent);
	}

	/**
	 * 允许以灯箱方式查看图片。
	 * 图片应预先携带好 data-lightbox 属性。
	 *
	 * 从父元素（约定为 figure）的 figcaption 子元素读取图片的标题。
	 *
	 * @param $container
	 * @returns {Promise<void>}
	 */
	TypechoCore.Element.fancybox = async function($container) {
		await TypechoCore.engine.requestResource([
			'https://lf6-cdn-tos.bytecdntp.com/cdn/expire-1-y/fancybox/3.5.7/jquery.fancybox.min.js',
			'https://lf26-cdn-tos.bytecdntp.com/cdn/expire-1-y/fancybox/3.5.7/jquery.fancybox.min.css'
		]);

		if (typeof $.fancybox === 'undefined') return;

		this.fancyOptions || (this.fancyOptions = {
			loop: true,
			buttons: ['slideShow', 'fullScreen', 'thumbs', 'download', 'zoom', 'close'],
			transitionEffect: "slide",
			thumbs: {
				axis: 'x',
			},
			lang: 'zh',
			i18n: {
				'zh': {
					CLOSE: '关闭',
					NEXT: '下一个',
					PREV: '上一个',
					ERROR: '内容加载失败。',
					PLAY_START: '播放幻灯片',
					PLAY_STOP: '暂停幻灯片',
					FULL_SCREEN: '全屏',
					THUMBS: '缩略图',
					DOWNLOAD: '下载',
					ZOOM: '缩放'
				}
			}
		});

		$container.find('[data-lightbox]').each(function () {
			const figureElement = $(this).parent();

			$(this).attr({
				'data-fancybox':	"articleBody",
				'data-caption':		figureElement.find('figcaption').text(),
			});

			$(this).fancybox(TypechoCore.Element.fancyOptions);
		});
	};

	TypechoCore.Element.carousel = async function($container) {
		await TypechoCore.engine.requestResource([
			'https://registry.npmmirror.com/@fancyapps/ui/latest/files/dist/carousel/carousel.umd.js',
			'https://registry.npmmirror.com/@fancyapps/ui/latest/files/dist/carousel/carousel.thumbs.umd.js',
			'https://registry.npmmirror.com/@fancyapps/ui/latest/files/dist/carousel/carousel.css',
			'https://registry.npmmirror.com/@fancyapps/ui/latest/files/dist/carousel/carousel.thumbs.css',
		]);

		const options = {
			l10n: 'zh_CN',
			Thumbs: { type: "modern" }
		};

		new Carousel($container[0], options, { Thumbs });
	};

	/**
	 * 为正文中的代码块提供高亮服务。
	 * 此函数会对 data-typecho-init 为 content-area 的元素自动执行。
	 * 其所有 pre 子元素均会使用 prismJS 执行一次高亮。
	 *
	 * @param $container
	 */
	TypechoCore.Element.prismJS = function($container) {
		const pres = $container[0].getElementsByTagName('pre');

		if (pres.length === 0 ) return;

		TypechoCore.engine.requestResource([
			resourceRoot + 'prism/prism.min.js',
			resourceRoot + 'prism/prism.min.css',
		]).then(function() {
			if (typeof Prism !== 'undefined') {
				for (let i = 0; i < pres.length; i++) {
					if (pres[i].getElementsByTagName('code').length > 0) pres[i].className = 'line-numbers';
				}

				Prism.highlightAll(false, null);
			}
		});
	};

	/**
	 * 为正文建立目录。
	 *
	 * @param $mainContent
	 * @returns {Promise<void>}
	 */
	TypechoCore.Element.toc = async function($mainContent) {
		const tocContainer = document.getElementById('toc');

		if (!tocContainer || tocContainer.length === 0) return;

		// 没有目录你 TOC 个卵
		if ($mainContent.find('h2').length === 0) return tocContainer.remove();

		await TypechoCore.engine.requestResource([
			'https://lf6-cdn-tos.bytecdntp.com/cdn/expire-1-y/tocbot/4.18.2/tocbot.min.js',
			'https://lf9-cdn-tos.bytecdntp.com/cdn/expire-1-y/tocbot/4.18.2/tocbot.min.css'
		]);

		const tocService = window['tocbot'];

		tocService.init({
			headingSelector:		'h2',
			activeLinkClass:		'is-active',

			tocSelector:			'.toc-target',
			contentSelector:		'.p-content',
			ignoreSelector:			'.js-toc-ignore',

			hasInnerContainers:		true,
			scrollSmooth:			true,
			scrollSmoothDuration:	40,
			headingsOffset:			20,
			scrollSmoothOffset:		-20,
			includeTitleTags:		true,
		});

		try {
			TypechoCore.utils.checkboxHack(tocContainer);
		} catch ( error ) {
			console.warn('未提供 checkboxHack 实现，目录按钮将不会工作。');
		}

		TypechoCore.xhr.listenOnce(function() {
			tocService.destroy();
			// 必须为 window 接触 scroll 事件，因受 TOC 影响其会与 tapTop 及 PJAX 冲突
			$(window).off('scroll');
		});
	};

	/**
	 * 点赞小控件。
	 *
	 * 通过 feedback 中的 increaseField 接口实现指定自定义字段的自增。
	 * 操作历史记录（以内容页面的 CID 形式）存储于 localStorage 中，以供每次页面加载时检查。
	 *
	 * @param $button 携带 data-typecho-init 值为 fabulous 的点赞按钮根元素
	 * @link https://dribbble.com/shots/5307333-Paw-Like-Button
	 */
	TypechoCore.Element.fabulous = function($button) {
		const buttonEl = $button[0],
			  // 存储于 localStorage 中的操作记录键名
			  fabRecordName = 'fab_record',
			  tpCore = TypechoCore,
			  contentId = Number(tpCore.content.id);

		// 未提供有效的 contentPermalink
		if (!tpCore.content.permalink) {
			console.warn(
				'TypechoCore 的 content.permalink 成员属性接口未生效。',
				'只有在提供了 permalink 属性的页面中，Fabulous 功能才能够正常工作。'
			);

			$button
				.attr('title', '此操作当前不可用。浏览控制台以进一步了解信息。')
				.css('cursor', 'not-allowed');

			return;
		}

		// 当前内容页面的 CID 已被执行过操作，则在此处将按钮变为已单击状态并退出即可，无需绑定单击事件
		if (tpCore.storage.localStorageArrayExists(fabRecordName, contentId)) {
			return $button.addClass('animation liked confetti noEffect');
		}

		let confettiAmount = 60,
			confettiColors = [
				'#7d32f5',
				'#f6e434',
				'#63fdf1',
				'#e672da',
				'#295dfe',
				'#6e57ff'
			],
			/** @returns { number|string } */
			random = (min, max) => {
				return Math.floor(Math.random() * (max - min + 1) + min);
			},
			createConfetti = to => {
				let elem = document.createElement('i');

				elem.style.setProperty('--x', random(-260, 260) + 'px');
				elem.style.setProperty('--y', random(-160, 160) + 'px');
				elem.style.setProperty('--r', random(0, 360) + 'deg');
				elem.style.setProperty('--s', random(.6, 1));
				elem.style.setProperty('--b', confettiColors[random(0, 5)]);

				to.appendChild(elem);
			};

		$button.on('click', function(event) {
			let number = buttonEl.children[1].textContent;

			/**
			 * 将按钮恢复至未单击状态。
			 */
			function recoverButton() {
				buttonEl.classList.remove('animation', 'liked', 'confetti');
				buttonEl.children[1].textContent = parseInt(number) - 1;
			}

			if (!buttonEl.classList.contains('animation')) {
				buttonEl.classList.add('animation');

				for (let i = 0; i < confettiAmount; i++) {
					createConfetti(buttonEl);
				}

				setTimeout(() => {
					buttonEl.classList.add('confetti');

					setTimeout(() => {
						buttonEl.classList.add('liked');
						buttonEl.children[1].textContent = parseInt(number) + 1;
					}, 400);
					setTimeout(() => {
						buttonEl.querySelectorAll('i').forEach(i => i.remove());
					}, 600);
				}, 260);

				if (tpCore.storage.localStorageArrayExists(fabRecordName, contentId)) {
					return event.preventDefault();
				}

				// 发送字段自增请求，需 tpCore 提供 contentPermalink 以拼接 actionURL
				tpCore.xhr.makeRequest({
					url: tpCore.content.permalink + '/increaseField', type: 'POST',
					success: (response) => {
						tpCore.storage.localStorageArray('fab_record', response.cid);
					},
					error: (xhr, status, error) => {
						// 请求失败，则撤销本次点击
						recoverButton();

						tpCore.ui.flashMessage('操作未能完成，可能是由于网络或服务器错误所导致。');
						console.error('Fabulous 请求发生错误。', xhr, status, error);
					}
				});
			} else {
				recoverButton();
			}

			event.preventDefault();
		});
	}

	/**
	 * 元素 prismJS、fancybox 与 carousel 已保留而不进行显式注册。因其目前应只在正文区域内有效。
	 * 这些元素统一由 content-area 处理并触发，但其内部各自有检测机制。
	 */

	TypechoCore.registerElement('animate-in');
	TypechoCore.registerElement('theme-switch');
	TypechoCore.registerElement('loader-indicator');

	TypechoCore.registerElement('content-area');

	TypechoCore.registerElement('fabulous');
}(window.jQuery, window, document);