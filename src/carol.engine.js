let Carol = window.Carol || {};

/**
 * 富文本编辑器启动器。
 *
 * @type { Object }
 */
Carol = {
	/** @type CarolEditor[] */
	editor: [],

	/**
	 * 注意只起暂存作用。
	 * 在创建新的 CarolEditor 实例后，原有的设置不再保留。
	 */
	editorOptions: {},

	/** @type HTMLTextAreaElement */
	editorArea:		null,
	/** @type HTMLElement */
	editTrigger:	null,

	securityToken:	null,
	contentId:		null,

	codeMirrorThemeConfig: [],

	init: function(editorArea, callback, config) {
		this.setEditorArea(editorArea);
		if (!this.editorArea || !CarolEditor) return;

		this.editorInit(callback, config);
	},

	setEditorArea: function(editorArea) {
		this.editorArea = editorArea;
	},

	setEditorOptions: function(config) {
		this.editorOptions = config;
	},

	setSecurityToken: function(token) {
		this.securityToken = token;
	},

	setContentId: function(id) {
		this.contentId = id;
	},

	getCurrentEditor: function() {
		return this.editor.slice(-1)[0];
	},

	/**
	 * 配置 CarolEditor 所使用的源代码编辑器（CM6）主题。
	 * 传入配置对象即可。自动转化为兼容性数组保存在 Carol.editor.config。
	 *
	 * @param { Object } config
	 */
	setCodeMirrorThemeConfig: function(config) {
		this.codeMirrorThemeConfig = Object.keys(config).map((key) => {
			return { [key]: config[key] };
		});
	},

	/**
	 * 配置下一次初始化 Carol 编辑器时需要一并载入的配置。
	 * 所有通过此方法声明的配置项拥有比默认配置更高的优先级。
	 *
	 * @param { string }	field 项目配置根名称
	 * @param { any }		value 此配置的实际值
	 */
	extendEditorOptions: function(field, value) {
		this.editorOptions[field] = value;
	},

	editorInit: function(callback, config) {
		let defaultOptions;

		defaultOptions = Object.assign({
			link: {
				addTargetToExternalLinks: true,
			},
			codeMirror: {
				themeConfig: this.codeMirrorThemeConfig
			},
			style: {
				definitions: [
					{ name: '圈住', element: 'span', classes: [ 'boxed' ] },
					{ name: '文艺青年', element: 'blockquote', classes: [ 'well-quote' ] },
					{ name: '黑幕', element: 'span', classes: [ 'spoiler' ] },
				]
			},
			codeBlock: {
				languages: [
					{ language: 'plaintext',	label: '纯文本' },
					{ language: 'js',			label: 'JavaScript' },
					{ language: 'css',			label: 'CSS' },
					{ language: 'html',			label: 'HTML' },
					{ language: 'php',			label: 'PHP' },
					{ language: 'json',			label: 'JSON' },
					{ language: 'cpp',			label: 'C++' },
					{ language: 'java',			label: 'Java' },
					{ language: 'apacheconf',	label: 'Apache 配置' },
					{ language: 'bash',			label: 'Bash' },
					{ language: 'sql',			label: 'SQL' },
				]
			},
			htmlSupport: {
				allow: [
					{ name: /.*/, attributes: true, classes: true, styles: true	}
				]
			},
			mediaEmbed: {
				previewsInData: true,
				providers: [
					{
						name: 'BiliBili',
						url: /^bilibili\.com\/video\/(\w+)/,
						html: match => `<iframe src="//player.bilibili.com/player.html?bvid=${ match[ 1 ] }&danmaku=0&autoplay=0" width="100%" height="500"></iframe>`
					},
				]
			},
			wordCount: {
				displayWords: false
			},
			placeholder: "这里是您的编辑区域。将光标聚焦至此处以开始创作。",
			// 适配 InstantEditor 在确有执行保存行为之后的处理
			updateSourceElementOnDestroy: true,
		}, this.editorOptions, config);

		CarolEditor
			.create(this.editorArea, defaultOptions)
			.then (editor => {
				this.editor.push(editor);

				if (typeof callback == 'function') callback(editor);

				const sourceElement = editor.sourceElement;
				if (sourceElement.tagName === 'TEXTAREA') {
					this.syncStatusChanges(sourceElement);
				}

				// 重置启动器参数
				this.editorOptions = {};
			})
			.catch(error => {
				console.error('Carol 编辑器出现错误。', error)
			});
	},

	/**
	 * 更改设置，使编辑器中做出的任意内容更改均同步至目标元素。
	 *
	 * @param { HTMLElement } sourceElement
	 *
	 * @see https://ckeditor.com/docs/ckeditor5/latest/installation/getting-started/getting-and-setting-data.html#demo
	 */
	syncStatusChanges: function( sourceElement) {
		const currentEditor = this.getCurrentEditor();

		currentEditor.model.document.on( 'change:data', () => {
			let isDirty = true;
			sourceElement.value = currentEditor.getData();
		} );
	},

	/**
	 * 此方法连接至 CarolEditor 的 ActionButton 扩展。
	 * 用户按下取消编辑（false）或保存更改（true）按钮时触发。
	 *
	 * @param { boolean }	submit	操作类型，为 true 则表示提交
	 * @param { string }	data	从 CarolEditor 中传出的编辑器数据
	 */
	commitAction: function(submit = true, data) {
		// 取消编辑或其它情况则仅刷新页面即可（历史记录已禁用），无需清理现场
		if (!submit || !this.editor || this.editor.length === 0) {
			return TypechoCore.engine.instantRedirect();
		}

		// 构造表单信息
		const token = this.securityToken,
			  method = 'POST',
			  // 操作终结点已被 PHP 固化
			  actionEndpoint = '/action/contents-post-edit';

		TypechoCore.xhr.makeRequest({
			url: actionEndpoint, type: method, data: {
				'do'	: 'fastPublish',
				'_'		: token,
				'cid'	: this.contentId,
				'text'	: data
			},
			success: (response) => { TypechoCore.engine.handleServerResponse(response) },
			error: function(xhr, status, error) {
				console.error('XHR 发生错误。', xhr, status, error);
				TypechoCore.ui.flashMessage('快速保存遇到错误，详见控制台信息。请先保存你的内容，然后刷新页面重试。')
			}
		});
	},

	/**
	 * 兼容 tpCore.xhrListen 的 bindNull，此销毁函数应设计为非上下文保持性。
	 *
	 * TODO: 考虑区分 destoryLast 与 destoryAll。
	 */
	destroy: function() {
		if (Carol.editor && Carol.editor.length > 0) {
			Carol.editor.forEach(function(editor) {
				// 移除工具栏
				editor.ui.view.toolbar.element.remove();
				editor.ui.view.editable.element.remove();

				// 为 instant editor 清理现场
				const elements = document.querySelectorAll('.instant-editor');
				elements.forEach(function(element) {
					element.classList.remove('instant-editor');
				});

				editor.destroy();
			});

			Carol.editor = [];
		}
	}
}