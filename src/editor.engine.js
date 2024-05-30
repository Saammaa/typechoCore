/**
 * 处理各种需要使用编辑器的情境。
 *
 * 使用基于 CKEditor5 的 Carol 编辑器。
 * 此 JS 仅负责处理带编辑权限用户的编辑器问题。评论区编辑器令见 commentEditor。
 *
 * 对经典编辑视图使用 classic-editor 初始化事件；
 * 对快速编辑视图使用 instant-editor 初始化事件。
 *
 * 经典编辑视图中还包括一些其它的辅助功能，具体参见代码正文。
 *
 * @version 021.0.1877.8(beta)
 * @author CuanKi-Raemon, Saammaa, 海, Fitz Gerald, 嫲嫲牲の, ...and others
 *
 * @requires Carol
 * @requires DarylEditor
 * @requires CarolEditor
 * @requires TypechoCore
 *
 * @link https://saammaa.com/carolEditor
 * @link https://ckeditor.com/docs/ckeditor5/latest/api
 */
!function($, window, document, _undefined) {
	"use strict";

	// 获取当前 JavaScript 的相对以及本地资源根
	const resourceRoot = TypechoCore.state('citizenRoot');

	/**
	 * 获取编辑器所需的必要资源。
	 *
	 * @param timestamp				配置版本唯一性时间戳
	 * @param useExternalSmiley		是否使用官方表情源
	 * @returns {(string|string)[]}
	 */
	function setupCarolResource(timestamp = '', useExternalSmiley) {
		// 注意先加载 build 再加载启动器
		return [
			resourceRoot		+ 'carol/carolEditor.js',
			resourceRoot		+ 'daryl/darylEditor.js',
			resourceRoot		+ 'carol/carol.js',

			'/common/themes/citizen/assets/carol/config-compiled.js?v=' + timestamp,
			// 表情配置已在上方文件中内置，若使用外部表情源，则此处只需要重新覆盖即可
			useExternalSmiley ? 'https://registry.npmmirror.com/typecho-core/use-cases-citizen/files/carol/carolExtends.min.js' : ''
		];
	}

	/**
	 * 适配 Citizen 的样式。
	 * 通过内部 EditorView.theme 投影为 extension 对象。
	 *
	 * @type Object
	 */
	const DARYL_THEME_CONFIG = {
		".cm-cursor": {
			borderLeftColor: "var(--color-base--subtle)"
		},
		".cm-gutters": {
			color: "var(--color-base--subtle)",
			backgroundColor: "var(--color-surface-3)",
			border: "none",
			transition: "var(--transition-background)"
		},
		".cm-activeLine": {
			backgroundColor: "var(--background-color-quiet--hover)"
		},
		".cm-activeLineGutter": {
			transition: "var(--transition-background)",
			backgroundColor: "var(--color-surface-4)",
		},
		".cm-tooltip": {
			border: "none",
			backgroundColor: "var(--color-surface-3)"
		},
		".cm-selectionBackground": {
			backgroundColor: "var(--color-surface-3) !important"
		}
	}

	/**
	 * 对于保存草稿操作，此回调负责接受从服务器返回的 draftId，并以此更新表单中的 CID 字段。
	 * 若页面含有携带 ID 为 lastDraftTime 的元素，将此元素的文本更新为本次保存草稿的时间戳。
	 *
	 * @param response
	 * @param nonceFormData
	 */
	TypechoCore.Callback.EditorDraft = function(response, nonceFormData) {
		if (!response.success) return;

		if (response['draftId']) {
			const cidInput = document.getElementById('cid');
			cidInput && (document.getElementById('cid').value = response['draftId']);
		}

		if (response['time']) {
			const statusTips = document.getElementById('statusTips'),
				draftNotice = document.getElementById('draftNotice'),
				noticeElement = document.createElement('p'),
				noticeInnerHTML = '当前正在编辑的是未发布的草稿，最后一次保存于：<b>' + response['time'] + '</b>。';

			if (!statusTips) return;

			if (!draftNotice) {
				noticeElement.classList.add('edit-draft-notice');
				noticeElement.id = 'draftNotice';
				noticeElement.innerHTML = noticeInnerHTML;

				TypechoCore.ui.setupHtmlInsert(statusTips, noticeElement, 0, false);
			} else {
				draftNotice.innerHTML = noticeInnerHTML;
			}
		}
	}

	/**
	 * 经典编辑视图，此视图下，用于执行快速保存操作的 ActionButton 将会移除。
	 * 回调事件主要处理加载指示器遮罩层。
	 *
	 * @param $editor
	 * @returns {Promise<void>}
	 */
	TypechoCore.Element.classicEditor = async function($editor) {
		const container = $editor.closest('.editor-container'),
			  versionString = $editor.data('version'),
			  useExternalSmiley = !!$editor.data('external-smiley'),
			  inspector = $('<span class="editor-inspector is-loading">正在加载工作区。</span>');
		inspector.appendTo(container);

		/** @type string[] */
		const edResource = setupCarolResource(versionString, useExternalSmiley);
		await TypechoCore.engine.requestResource(edResource);

		Carol.setCodeMirrorThemeConfig(DARYL_THEME_CONFIG);

		Carol.init($editor[0], function(editor) {
			const toolbar = editor.ui.view.toolbar.element;

			// 在编辑器容器中插入工具栏
			$editor.before($(toolbar));

			// 移除编辑器加载指示器
			inspector.removeClassTransitioned('is-loading',
				function() { inspector.remove() });

			// 允许编辑者通过 CTRL + S 快速保存草稿
			TypechoCore.utils.bindKey(function() {
				if (document.getElementById('title').value === '') {
					return TypechoCore.ui.flashMessage('应至少提供一个标题，才能执行快速保存。');
				}

				// 懒（本来我在这里复制粘贴了二十个懒，结果后来发现有点恐怖谷，so ~）
				document.getElementById('save').click();
			}, (event) => {
				// 绑定至 CTRL + S 按键
				return (event.ctrlKey || event.metaKey) && event.which === 83
			});

		}, { removePlugins: [ 'ActionButton' ] });

		TypechoCore.xhr.listenOnce(Carol.destroy, 'click');
	};

	/**
	 * 快速编辑视图。此视图下，工具栏右侧携带快速保存按钮。
	 * 单击该按钮，对应触发 Carol.commitAction() 函数。
	 *
	 * 回调函数主要处理工具栏的移动和动画。
	 * 此代码层 $control 绑定器的注意事项见 requestResource 说明。
	 *
	 * @requires requestResource
	 * @param $control
	 * @returns {Promise<void>}
	 */
	TypechoCore.Element.instantEditor =  function($control) {
		const editorArea = document.getElementById($control.data('editor')),
			  versionString = $control.data('version'),
			  useExternalSmiley = !!editorArea.getAttribute('data-external-smiley'),
			  typechoSecurityToken = $control.data('typecho-security-tk'),
			  contentId = $control.data('cid'),
			  coverContainer = $('.p-cover');

		/**
		 * 编辑器完成初始化之后的回调函数。
		 * @param editor
		 */
		const callback = function(editor) {
			const toolbar   = $(editor.ui.view.toolbar.element),
				  container = $control.closest('.container').addClass('instant-editor');

			// 已使用内部方法处理工具栏添加
			TypechoCore.ui.setupHtmlInsert(container, toolbar, 0, false, 'editor-toolbar');

			// 快速编辑器可以通过直接执行 ActionButton 提供的 commitSubmit 指令
			TypechoCore.utils.bindKey(function() {
				editor.execute('commitSubmit');
			}, (event) => {
				// 绑定至 CTRL + S 按键
				return (event.ctrlKey || event.metaKey) && event.which === 83
			});

			// 禁用编辑器历史记录，简单粗暴避免清理现场
			TypechoCore.utils.disableHistoryOnce();

			// 进入编辑模式后即可移除此触发器按钮
			$control.remove();
		};

		$control.on('click', function() {
			coverContainer && coverContainer.css('opacity', .5);
			$control.html('<div class="loading"></div>处理中').off('click');

			// 整体禁用评论区域
			let commentArea = document.getElementById('comments');
			if (!commentArea) {
				commentArea = document.querySelector('[data-typecho-init="discussion"]');
			}

			if (commentArea) {
				commentArea.title = '快速编辑模式。所有评论功能已禁用。';
			}

			/** @type string[] */
			const edResource = setupCarolResource(versionString, useExternalSmiley);

			TypechoCore.engine.requestResource(edResource).then(r => {
				// 预取并重置正文中的原始内容，因当前 HTML 区域可能已被其它 JS 所影响
				TypechoCore.xhr.makeRequest({
					type:	'POST',
					url:	'/action/contents-post-edit',
					data:	{
						do: 'fastPublish',
						'_' : typechoSecurityToken,
						cid: contentId,
						preheat: contentId
					},
					success: async (response) => {
						// 关闭封面图
						coverContainer && coverContainer.remove();

						Carol.setContentId(contentId);
						Carol.setSecurityToken(typechoSecurityToken);
						Carol.setCodeMirrorThemeConfig(DARYL_THEME_CONFIG);

						// 直接使用 TypechoCore 的记录即可
						editorArea.innerHTML = TypechoCore.content.html;

						const draftInfo = response['draft'];
						if (draftInfo && draftInfo.parent) {
							const draftContentId	= draftInfo.cid,
								draftContent		= draftInfo.text,
								draftModifiedTime	= draftInfo.modified;
							const draftModified = new Date(draftModifiedTime * 1000);

							function chooseDraft() {
								editorArea.innerHTML = draftContent;
								Carol.setContentId(draftContentId);
							}

							const message =
								'此文章包含草稿。草稿保存于 ' + draftModified.toLocaleTimeString() + '。' +
								'编辑它的草稿，还是编辑当前已经发布的此文章本身？'

							await TypechoCore.ui.dialog('检测到草稿', message, [
								{ text: '编辑草稿', callback: chooseDraft },
								{ text: '编辑已发布文章', type: 'primary' }
							], false);
						}

						// 对于草稿文章需要执行特殊处理
						Carol.init(editorArea, callback);

						// 记得回收实例
						TypechoCore.xhr.listenOnce(Carol.destroy);
					}
				});
			});
		});
	};

	/**
	 * 由于 CKEditor5 不可重复加载，故 Carol 与 CommentEditor 不能同时引用。
	 * 单页浏览时，若存在可能同时引用的情况，则 CommentEditor 的调用者应将其 Trigger 重定向至此方法，以避免发生错误。
	 *
	 * @param { Object }		$trigger			能够触发评论编辑器的原始 comment-editor 控件的 jQ 对象
	 * @param { HTMLElement }	editorArea			原始编辑器区域
	 * @param { Object }		container			编辑器所在的 editor-container 容器
	 * @param { string }		versionString		配置版本唯一性时间戳
	 * @param { boolean }		useExternalSmiley	是否使用外部表情库
	 * @param { Object }		inspector			编辑器加载器指示器 jQ 元素对象
	 * @param { function }		editorCallback		编辑器加载完成的回调函数
	 * @returns { Promise<void> }
	 */
	TypechoCore.Element.commentEditorCarol = function(
		$trigger,
		editorArea,
		container,
		versionString,
		useExternalSmiley,
		inspector,
		editorCallback
	) {
		$trigger.on('click', function () {
			$(this).html('<div class="loading"></div>处理中').off('click');
			inspector.appendTo(container);

			/** @type string[] */
			const edResource = setupCarolResource(versionString, useExternalSmiley);

			TypechoCore.engine.requestResource(edResource).then(function() {
				Carol.init(editorArea, (editor) => {
					editorCallback(editor, $trigger, editorArea, inspector);
				}, {
					// 重置 Carol 默认的管理员编辑器 placeholder 文本为评论编辑器的 placeholder
					placeholder: null,
					removePlugins: [
						'ActionButton', 'Heading', 'Template', 'Table', 'FormatPainter', 'HtmlEmbed',
						'Image', 'ImageInsertUrlUIHack', 'LinkImage', 'MediaEmbed', 'MediaEmbedToolbar'
					],
					toolbar: {
						items: [
							"undo", "redo",
							"bold", "italic", "underline", "strikethrough", "fontSize", "fontColor",
							"style",
							"link", "code", "blockQuote", "codeBlock", {
								label: '段落控制',
								items: [ 'alignment', 'numberedList', 'bulletedList', 'todoList', 'outdent', 'indent' ]
							},
							"smiley", "accessibilityHelp"
						]
					}
				})
			});
		});
	}

	/**
	 * 使用更为现代的 CodeMirror6 编辑器。
	 * 此 DarylEditor 为 CM6 的 WEB 封装，接受一个 DOMEl 与主题配置。
	 *
	 * 避免为此触发器连续声明多个 data-typecho-init。
	 * 同一个页面中，仅向应包含编辑器的容器注册即可，携带 data-language 的文本域会被触发。
	 *
	 * @param $sourceElement
	 * @returns {Promise<void>}
	 */
	TypechoCore.Element.sourceEditor = async function($sourceElement) {
		await TypechoCore.engine.requestResource(resourceRoot + "daryl/darylEditor.js");

		function darylCreate($el) {
			DarylEditor.create($el[0], DARYL_THEME_CONFIG, $el.data('language'));
		}

		if (!$sourceElement.is('textarea')) {
			$sourceElement.find('textarea[data-language]').each(function() {
				darylCreate($(this));
			});
		} else {
			darylCreate($sourceElement);
		}

		TypechoCore.xhr.listenOnce(DarylEditor.destroy, 'click');
	};

	/**
	 * 编辑页面实用辅助。
	 *
	 * @param $form
	 */
	TypechoCore.Element.writerHelper = function($form) {
		const visibility = $('select[name = visibility]');

		// 自动隐藏密码输入控件
		function initPasswordSet($selector) {
			const val = $selector.val(),
				password = $('.p-password');

			if (val === 'password') {
				password.removeClass('hidden');
			} else {
				password.addClass('hidden');
			}
		}

		initPasswordSet(visibility);
		visibility.change(function () {
			initPasswordSet(visibility);
		});
	};

	/**
	 * 响应时间日期选择控件的初始化。
	 *
	 * @param $selector	携带 data-typecho-init 属性为 time-picker 的 jQuery 对象
	 */
	TypechoCore.Element.timePicker = async function($selector) {
		await TypechoCore.engine.requestResource([
			'https://lf6-cdn-tos.bytecdntp.com/cdn/expire-1-y/jqueryui/1.12.1/jquery-ui.min.js',
			'https://lf6-cdn-tos.bytecdntp.com/cdn/expire-1-y/jquery.mask/1.14.16/jquery.mask.min.js',
			'https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-y/jquery-ui-timepicker-addon/1.6.3/jquery-ui-timepicker-addon.min.js',

			'https://lf3-cdn-tos.bytecdntp.com/cdn/expire-1-M/jquery-ui-timepicker-addon/1.6.3/jquery-ui-timepicker-addon.min.css'
		]);

		if (typeof $.fn.datetimepicker == 'undefined' || typeof $.fn.mask === 'undefined') {
			console.error('jQuery DateTimePicker 或 Mask 未加载。');
			return;
		}

		$selector.mask('9999-99-99 99:99').datetimepicker({
			currentText		: '现在',
			prevText		: '上一月',
			nextText		: '下一月',
			monthNames		: ['一月', '二月', '三月', '四月', '五月', '六月', '七月', '八月', '九月', '十月', '十一月', '十二月'],
			dayNames		: ['星期日', '星期一', '星期二', '星期三', '星期四', '星期五', '星期六'],
			dayNamesShort	: ['周日', '周一', '周二', '周三', '周四', '周五', '周六'],
			dayNamesMin		: ['日', '一', '二', '三', '四', '五', '六'],
			closeText		: '完成',
			timeOnlyTitle	: '选择时间',
			timeText		: '时间',
			hourText		: '时',
			amNames			: ['上午', 'A'],
			pmNames			: ['下午', 'P'],
			minuteText		: '分',
			secondText		: '秒',

			dateFormat		: 'yy-mm-dd',
			timezone		: $selector.data('timezone') / 60,
			hour			: (new Date()).getHours(),
			minute			: (new Date()).getMinutes()
		});

		// 清理容器外部冗余元素
		TypechoCore.xhr.listenOnce(() => {
			$('.ui-datepicker').remove();
		});
	};

	/**
	 * 标签输入控件，使用 jQuery TokenInput。
	 *
	 * @param $input
	 * @package jquery.tokenInput.js
	 * @version 1.7.0
	 * @link https://github.com/loopj/jquery-tokeninput
	 */
	TypechoCore.Element.tagsHelper = async function($input) {
		await TypechoCore.engine.requestResource([
			'https://lf26-cdn-tos.bytecdntp.com/cdn/expire-1-y/jquery-tokeninput/1.7.0/jquery.tokeninput.min.js',
		]);

		if (typeof $.fn['tokenInput'] == 'undefined') {
			return console.error('jQuery TokenInput 未加载。');
		}

		const tagsInfo = $('[data-tags-info]').data('tags-info'),
			tagsClass = $input.data('tag-class'),
			tagsPre = [],
			dropDownClass = 'p-token--dropdown',
			items = $input.val().split(',');

		for (let i = 0; i < items.length; i ++) {
			const tag = items[i];
			if (!tag) continue;

			tagsPre.push( { id: tag, tags: tag } );
		}

		$input.tokenInput(tagsInfo, {
			// 此配置必须为 true
			allowFreeTagging	: true,
			allowTabOut			: true,

			propertyToSearch	: 'tags',
			tokenValue			: 'tags',
			searchingText		: '处理中...',
			searchDelay			: 200,
			preventDuplicates	: true,
			hintText			: '请输入标签名。',
			noResultsText		: '此标签不存在，回车即可创建。',
			prePopulate			: tagsPre,

			// 动画难看
			animateDropdown		: false,

			// 别这样，真的
			classes: {
				token			: 'p-token',
				selectedToken	: 'p-token--selected',
				tokenDelete		: 'p-token--delete',
				tokenList		: 'p-token--list u-inputWidget-input',
				inputToken		: 'p-token--input',
				focused			: 'p-token--focused',
				dropdown		:  dropDownClass,
				dropdownItem	: 'p-token--dropdownItem',
				dropdownItem2	: 'p-token--dropdownItemB',
				selectedDropdownItem: 'p-token--dropdownSelected'
			},

			onResult : function (result, query, val) {
				if (!query) return result;
				if (!result) result = [];

				if (!result[0] || result[0]['id'] !== query) {
					result.unshift({
						id: val, tags: val
					});
				}

				return result.slice(0, 5);
			}
		});

		$('.' + tagsClass).on('click', function() {
			const val = $(this).text();
			$input['tokenInput']('add', {
				id: val, tags: val
			});
		})

		// 清理现场，销毁 tokenInput 对象
		TypechoCore.xhr.listenOnce(function () {
			$input['tokenInput']("destroy");
			$('.' + dropDownClass).remove();
		});
	};

	TypechoCore.registerElement('source-editor');
	TypechoCore.registerElement('classic-editor');
	TypechoCore.registerElement('instant-editor');

	TypechoCore.registerElement('writer-helper');
	TypechoCore.registerElement('tags-helper');
	TypechoCore.registerElement('time-picker');
}
(jQuery, window, document);