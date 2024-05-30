!function($, window, document, _undefined) {
	const resourceRoot = TypechoCore.state('citizenRoot'),
		  localResourceRoot = '/common/themes/citizen/assets/discussion/'

	const ED_RESOURCE = [
		resourceRoot + 'discussion/commentEditor.js',
	];

	let SMILEY_CONFIG = "https://registry.npmmirror.com/typecho-core/latest/files/carol/carolExtends.min.js";

	TypechoCore.Element.discussion = function($threaded) {
		const $title		= $('[data-comment-title]'),
			  $form			= $('[data-comment-form]'),
			  $submitButton	= $('[data-comment-submit]'),
			  originalTitleText = $title.text();

		let $replyHiddenInput = $('<input>')
			.attr('type', 'hidden')
			.attr('name', 'parent');

		let $replyButton = $('<button>取消回复</button>')
			.addClass('p-button p-button--destructive')
			.on('click', function() {
				$title.text(originalTitleText);
				$replyHiddenInput.remove();
				$(this).detach();
			});

		$threaded.find('[data-comment-reply]').on('click', function() {
			// FIXME: 不是很稳定。WHY？
			TypechoCore.utils.scrollTo($threaded);

			const $commenterName	= $(this).data('comment-reply'),
				  $currentComment	= $(this).closest('.comment-item'),
				  currentCommentNativeId = $currentComment.attr('id'),
				  titleTextForReply =  '@' + $commenterName + '：';

			// 获取所回复评论的 ID。应在其骨架 Parent 元素中包含 nativeID，放能够正常读取
			const nativeSplit = currentCommentNativeId.lastIndexOf("-"),
				  currentCommentId = currentCommentNativeId.substring( nativeSplit + 1, currentCommentNativeId.length );

			$replyHiddenInput.val(currentCommentId).appendTo($form);
			$title.text(titleTextForReply);

			$replyButton.detach();
			$submitButton.before($replyButton);
		});
	};

	/**
	 * 异步请求 reCAPTCHA 服务。
	 * 要使得 reCAPTCHA 工作，应存在类名为 g-recaptcha 且正确携带 data-sitekey 属性的元素。
	 *
	 * 在此方法中，目标元素应为 div。此容器的显示被绑定至当前函数载荷的单击事件上。
	 *
	 * @param $challengeTrigger
	 * @returns {Promise<void>}
	 */
	TypechoCore.Element.discussionCaptcha = async function($challengeTrigger) {
		// reCAPTCHA placeholder element must be empty
		const $captcha = $('.g-recaptcha').html(''),
			  loadedAtLeastOnce = TypechoCore.engine.isResolved('api.js');

		await TypechoCore.engine.requestResource('https://recaptcha.net/recaptcha/api.js');

		// 处理后续由 xhr 动态加载页面时，目标 reCAPTCHA 元素的加载方式，此时已不能通过 API.js 自动加载
		loadedAtLeastOnce && window['grecaptcha'].render($captcha[0]);

		// 为当前载荷绑定单击事件以实现 reCAPTCHA 元素的切换显示
		TypechoCore.ui.switchable($challengeTrigger, $captcha);

		// 清理 reCAPTCHA 所创建的垃圾 div，根据下述类名元素定位
		TypechoCore.xhr.listenOnce(function() {
			$('.g-recaptcha-bubble-arrow').parent().remove();
		}, 'click');
	};

	/**
	 * 此回调应通过 data-callback 附加至携带 ajax-submit 触发器的元素。
	 * 声明 data-callback=discussionCallback，则在发送表单并获取服务器响应后自动执行此回调。
	 *
	 * 主要处理 reCAPTCHA 的更新（响应状态为失败时）以及新元素在已有评论列表中的追加。
	 * 新动态添加的评论元素携带 comment-new 类名，且对于排序规则不同的评论列表，其添加位置不同。
	 * 要求响应成功且必须携带含有新评论元素 HTML 字符串的信息，方能够正常添加。
	 *
	 * @param response		继承自 TypechoCore，服务器响应 Nonce 对象
	 * @param nonceFormData	继承自 TypechoCore，已提交的表单数据 Nonce 对象
	 */
	TypechoCore.Callback.discussionCallback = function(response, nonceFormData) {
		if (!response || !response.success) {
			return TypechoCore.Element.gCaptchaCallback(false);
		}

		const parentId	= response['parentId'],
			  commentWrapperClass = 'comment-list',
			  wrapperSelector = '.' + commentWrapperClass;

		let container	= document.getElementById('comments'),
			commentOrder = container.getAttribute('data-order'),
			// 根据 dataset 数据判初步决定新评论的插入位置：在列表的顶部还是底部插入
			// 取决于评论是降序（DESC，最新的在最前）排列还是升序（ASC，最旧的在最前）排列
			insertAtFront = commentOrder === 'DESC',
			commentHTML = response.content;

		// 清理编辑区域
		container.querySelector('textarea').value = '';

		// 清理编辑区域（富文本编辑器）
		const commentEd = TypechoCore.State.commentEditorInstance;
		if (commentEd) commentEd.setData('');

		// 尝试选取评论列表的根部容器，若未找到此容器，则说明所发布的评论为内容的第一条评论
		const commentList = container.querySelector(wrapperSelector);
		if (!commentList) {
			commentHTML = '<ol class="' + commentWrapperClass + '">' + commentHTML + '</ol>';
			insertAtFront = false;
		} else if (parentId) {
			// 新评论为已有评论的子评论，即所发布的评论是一个回复，显然这种情况下，commentList 一定已经存在
			container = document.getElementById('comment' + '-' + parentId);
			// 对于回复而言，在其执行插入时，一定需要插入到最后
			insertAtFront = false;
		} else {
			// 已找到根部容器，且发布的评论不是其它评论的回复，则将此新评论正确地插入根容器中
			container = commentList;
		}

		// 执行插入。若排序为 DESC（最新评论位于最前方），则显然应在容器最前方插入
		const offset = insertAtFront ? 0 : 1;

		// 获取返回值以进一步处理 LazyLoad，注意需预先提供 lazy 类名
		const inserted = TypechoCore.ui.setupHtmlInsert($(container), commentHTML, offset, true, 'comment-new');
		TypechoCore.utils.lazyLoad(inserted, 'img');

		// 禁用新评论的头像单击事件
		inserted.find('[data-comment-reply] > *').css('pointer-events', 'none');
		inserted.find('[data-comment-reply]')
			.attr('title', '你刚刚发布这条评论。在重新加载此页面之前，你还不能对它本身进行回复。')
			.css('cursor', 'not-allowed');
	}

	/**
	 * 负责响应 reCAPTCHA 状态的回调。
	 * 接受两种状态，它们会被反映给验证码的触发器元素，以修改其颜色与提示文本。
	 *
	 * @param success				成功状态
	 * @param flashMessageOnError	是否在失败时执行一次 flashMessage 提示
	 */
	TypechoCore.Element.gCaptchaCallback = function (success, flashMessageOnError) {
		const $challengeTrigger = $('.comment-captcha'),
			  $captcha = $('.g-recaptcha'),
			  buttonClassBase = 'p-button--',
			  successClass = buttonClassBase + 'interactive',
			  failedClass = buttonClassBase + 'destructive';

		let triggerTipText = 'reCAPTCHA 已通过，评论所在表单将验证为有效。'

		if (!success) {
			$challengeTrigger.addClass(failedClass).removeClass(successClass);
			triggerTipText = 'reCAPTCHA 未通过。请验证。';

			flashMessageOnError && TypechoCore.ui.flashMessage(triggerTipText)
		} else {
			$challengeTrigger.addClass(successClass).removeClass(failedClass);
			$captcha.addClass('u-hidden');
		}

		$challengeTrigger.attr('title', triggerTipText);
	};

	/**
	 * 注意：若存在 editor.js，则 discussion.js 必须在其之后加载，
	 * 否则 commentEditor 无法获取到 classic-editor 的注册状态。
	 *
	 * @param { Object } $control
	 * @returns { Promise<void> }
	 */
	TypechoCore.Element.commentEditor = function($control) {
		// 仅在初始化最开始时执行无感的加载即可
		TypechoCore.engine.requestResource(TypechoCore.state('citizenRoot') + 'css/editor.css').then();

		const editorArea = document.getElementById($control.data('editor')),
			  container = editorArea.closest('.editor-container'),
			  versionString = $control.data('version'),
			  useExternalSmiley = !!editorArea.getAttribute('data-external-smiley');

		// 编辑器加载指示器。若编辑器已经实例化，则不再显示指示器
		let inspector = $('<span class="editor-inspector is-loading">正在加载评论编辑器。</span>');
		if (TypechoCore.State.commentEditorInstance) inspector = $('');

		// 简单封装此回调以便传递给 editorJS 复用
		function commentEditorCallback(editor, control, editorArea, inspector) {
			TypechoCore.State.commentEditorInstance = editor;

			const toolbar = $(editor.ui.view.toolbar.element);

			// 插入工具栏、移除加载提示器
			TypechoCore.ui.setupHtmlInsert($(editorArea), toolbar, -1);
			inspector.removeClassTransitioned('is-loading',
				function() { inspector.remove() }
			);

			editor.model.document.on( 'change:data', () => {
				let isDirty = true;
				editor.sourceElement.innerText = editor.getData();
			} );

			control.remove();
		}

		// 存在 instantEd 或 classicEd，则将 $control 的单击事件移交给 editorJS 处理
		if (
			TypechoCore.isElementRegistered('instant-editor') ||
			TypechoCore.isElementRegistered('classic-editor')
		) {
			return TypechoCore.Element.commentEditorCarol(
				$control, editorArea, container, versionString,
				useExternalSmiley, inspector, commentEditorCallback
			);
		}

		$control.on('click', function () {
			$(this).html('<div class="loading"></div>处理中').off('click');
			inspector.appendTo(container);

			// 虚拟一个 Carol 启动器，以确保表情配置能够正常作为启动器参数进行载入
			if (typeof Carol == 'undefined') {
				Carol = {
					editorOptions: {},

					extendEditorOptions: function(field, value) {
						this.editorOptions[field] = value;
					}
				}
			}

			// 加载表情配置
			if (!useExternalSmiley) {
				SMILEY_CONFIG = localResourceRoot + 'smiley-compiled.js?v=' + versionString;
			}
			const edResource = ED_RESOURCE.concat(SMILEY_CONFIG);

			TypechoCore.engine.requestResource(edResource).then( r => {
				CommentEditor
					.create(editorArea, Carol.editorOptions)
					.then ( editor => {
						commentEditorCallback(editor, $control, editorArea, inspector);
				} );
			});
		})
	};

	TypechoCore.registerElement('discussion');
	TypechoCore.registerElement('discussion-captcha');
	TypechoCore.registerElement('comment-editor');
}(jQuery, window, document);

// 此处函数负责处理 gRe 两种通用状态的回调
function gReExpired() { TypechoCore.Element.gCaptchaCallback(false)	}
function gReSuccess() { TypechoCore.Element.gCaptchaCallback(true)	}