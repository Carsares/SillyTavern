// Chinese descriptions for errors returned when the Agent projects the saved Modern settings.
// The server keeps stable codes and field names; these texts are presentation only.

const CODE_MESSAGES = {
    'workspace-unsupported': 'Agent 暂不支持当前设置',
    'workspace-resource-unavailable': '所选角色、人设、预设或世界书文件缺失、无法读取或格式无效',
    'workspace-validation-failed': 'Agent 无法用当前设置创建会话',
    'workspace-start-failed': 'Agent 会话创建失败，请稍后重试',
    'request-too-large': '请求内容过大',
    'schema-version': 'Agent 协议版本不一致，请刷新页面后重试',
    'authentication-required': '请先登录再使用 Agent',
    unauthorized: '请先登录再使用 Agent',
    'workspace-changing': '账号数据正在变更，完成后请刷新页面',
    'agent-unavailable': 'Agent 工作区无法打开，请检查存储版本或是否有其他进程占用',
    'shutting-down': '服务正在停止',
};

const EXACT_FIELDS = {
    main_api: '当前 API 类型不是对话补全（Chat Completion）。Agent 只支持对话补全类连接，请在 API 页面切换后重试',
    oai_settings: '对话补全设置缺失或格式无效',
    'oai_settings.chat_completion_source': 'Agent 只支持 Custom（OpenAI 兼容）、OpenAI 和 DeepSeek 三种对话补全来源',
    'oai_settings.custom_model': '未选择模型',
    'oai_settings.openai_model': '未选择模型',
    'oai_settings.deepseek_model': '未选择模型',
    'oai_settings.baseUrl': '接口地址无效，需要是不含账号、查询参数和锚点的 http(s) 地址',
    'oai_settings.budgets': '上下文长度或最大回复长度无效，上下文长度需比最大回复长度多 256 以上',
    'oai_settings.reasoning_effort': '推理强度只支持「自动」或「关闭」',
    'oai_settings.reverse_proxy': '不支持反向代理',
    'oai_settings.custom_include_body': '不支持附加请求体参数',
    'oai_settings.custom_exclude_body': '不支持排除请求体参数',
    'oai_settings.custom_include_headers': '不支持附加请求头',
    'oai_settings.assistant_prefill': '不支持助手预填充',
    'oai_settings.assistant_impersonation': '不支持代拟预填充',
    'oai_settings.squash_system_messages': '不支持合并系统消息',
    'oai_settings.top_a_openai': '不支持 Top A 采样参数',
    'secrets.format': '密钥设置格式无效',
    'secrets.active': '同一来源只能启用一个密钥',
    'connection.capabilities': '当前连接的服务能力不满足 Agent 的要求',
    executor: '不支持该执行器',
    'executor.provider-protocol': 'Claude 执行器只支持 DeepSeek 官方接口，Codex 执行器只支持 DeepSeek 或 OpenAI 官方接口；其他接口请使用 PI 执行器',
    'executor.provider-path': 'DeepSeek 接口地址的路径无效',
    characterId: '未选择角色或角色文件名无效',
    character: '角色卡缺少名称或格式无效',
    'character.extensions.regex_scripts': '角色卡启用了正则脚本，Agent 不执行正则脚本',
    'character.depth_prompt.role': '角色深度提示词的角色设置无效',
    'extension_settings.regex': '已启用全局正则脚本，Agent 不执行正则脚本',
    personaId: '人设无效',
    'personaId.multiple-character-connections': '当前角色关联了多个人设，请先在聊天中明确选择一个',
    'persona.position': '人设描述的插入位置不受支持',
    'persona.role': '人设描述的角色设置不受支持',
    'world_info.globalSelect': '全局世界书选择无效',
    worldbookIds: '世界书选择无效',
    'worldbookIds.limit': '同时启用的世界书超过 32 本',
    'worldbook.entries': '世界书条目格式无效',
    'worldbook.entries.limit': '单本世界书超过 2000 个条目',
    'worldbook.entry': '世界书条目格式无效',
    'worldbook.entry.use_regex': '世界书条目使用了正则匹配，Agent 只支持普通关键词',
    'worldbook.keys': '世界书关键词无效，Agent 不支持正则关键词',
    'worldbook.position': '世界书条目的插入位置不受支持',
    'worldbook.secondaryLogic': '世界书次要关键词的逻辑不受支持（不支持「NOT ALL」）',
    'worldbook.characterFilter': '世界书条目设置了角色过滤，Agent 暂不支持',
    resourceId: '资源名称无效',
    'resource.size': '资源文件过大',
    'resource.format': '资源文件格式无效',
    request: '请求参数无效',
    'request.fields': '请求参数无效',
    title: '会话标题无效',
};

// Longest matching prefix wins; covers fields that carry a setting or entry name.
const PREFIX_FIELDS = [
    ['executor.parameters.', 'Claude/Codex 执行器使用服务端默认采样参数，请把温度等采样参数恢复默认值，或改用 PI 执行器'],
    ['oai_settings.', '采样参数无效'],
    ['world_info_settings.', '世界书全局设置启用了 Agent 暂不支持的功能（最少激活数或分组评分）'],
    ['worldbook.entry.', '世界书条目启用了 Agent 暂不支持的功能（如向量化、分组、延迟、粘滞、冷却、递归控制、额外匹配来源或触发器）'],
    ['preset.prompt.', '预设中的提示词条目设置不受支持'],
    ['preset.', '预设中有 Agent 暂不支持的设置'],
    ['directories.', '用户数据目录不可用'],
];

function describeField(field) {
    if (field.endsWith('.macros')) return '文本里有 Agent 不支持的宏，只支持 {{char}}、{{user}}、{{scenario}} 和 {{type}}';
    if (Object.hasOwn(EXACT_FIELDS, field)) return EXACT_FIELDS[field];
    if (/\.(description|personality|scenario|content)$/.test(field)) return '文本格式无效或超过 10 万字符';
    return PREFIX_FIELDS.find(([prefix]) => field.startsWith(prefix))?.[1] ?? '';
}

/**
 * @param {{ code?: string, message?: string, details?: { fields?: unknown } }} error Server error body
 * @returns {string} Chinese message, or '' when the code and fields are unknown.
 */
export function describeAgentError({ code, message, details } = {}) {
    const fields = Array.isArray(details?.fields) ? details.fields.filter(field => typeof field === 'string') : [];
    const lead = (code && CODE_MESSAGES[code]) || (fields.length ? CODE_MESSAGES['workspace-unsupported'] : message) || '';
    if (!fields.length) return lead;
    // Field names stay visible so a report can be matched to the exact setting.
    return `${lead}：${fields.map(field => `${describeField(field) || '该设置无法转换'}（${field}）`).join('；')}`;
}
