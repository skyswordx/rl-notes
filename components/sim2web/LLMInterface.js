/**
 * LLM Interface - Stub Implementation
 * 预留接口用于 XAI 解释和奖励工程
 */

/**
 * Feature A: Interactive Policy Explainer
 * 收集当前帧的 State/Action/Value，构建 Prompt 发送给 LLM
 * @param {ExplainRequest} request 
 * @returns {Promise<string>} LLM 解释
 */
export async function explainAction(request) {
    // TODO: 实现 LLM API 调用
    const { state, action, value, question } = request;

    // 构建 Prompt 模板
    const prompt = `你是一个机器人控制专家。
当前状态：末端距离目标 ${state.distance.toFixed(3)}m，关节速度 ${state.velocity.toFixed(2)}rad/s。
模型动作：施加力矩 [${action.map(a => a.toFixed(2)).join(', ')}]。
Critic 价值预估：${value.toFixed(3)}。
用户问题：${question}
请向非专业用户解释为什么机器人选择了这个动作。`;

    console.log('[LLM Stub] ExplainAction Prompt:', prompt);

    // Stub 返回
    return `[LLM 接口预留] 当前为占位符响应。实际部署时将调用 LLM API 解释策略决策。
    
示例回答：机器人检测到距离目标很近但速度仍然较高，为了避免冲过头（Overshoot），它选择施加反向力矩来减速。`;
}

/**
 * Feature B: Reward Designer - Code Gen
 * 根据用户自然语言反馈生成奖励函数代码
 * @param {RewardDesignRequest} request 
 * @returns {Promise<RewardDesignResponse>}
 */
export async function designReward(request) {
    // TODO: 实现 LLM API 调用
    const { userFeedback, currentRewardCode } = request;

    console.log('[LLM Stub] DesignReward Feedback:', userFeedback);

    // Stub 返回
    return {
        suggestedCode: `# 建议的奖励函数修改 (基于用户反馈: "${userFeedback}")
def compute_reward(obs, action, next_obs):
    distance = np.linalg.norm(obs['achieved_goal'] - obs['desired_goal'])
    
    # 原始距离奖励
    distance_reward = -distance
    
    # 新增：平滑度惩罚 (基于用户反馈)
    torque_penalty = -0.01 * np.sum(action ** 2)
    smoothness_penalty = -0.05 * np.sum((action - prev_action) ** 2)
    
    return distance_reward + torque_penalty + smoothness_penalty`,
        alternativeModelPath: '/models/robot_policy_smooth.onnx',
        message: '[LLM 接口预留] 已生成建议的奖励函数。可加载预训练的"平滑风格"模型。'
    };
}

/**
 * 预训练模型路径映射
 * 用于根据用户反馈热切换到不同风格的策略模型
 */
export const POLICY_VARIANTS = {
    default: '/models/robot_policy.onnx',
    smooth: '/models/robot_policy_smooth.onnx',      // 平滑风格
    aggressive: '/models/robot_policy_aggressive.onnx', // 激进风格
    energy_efficient: '/models/robot_policy_efficient.onnx', // 节能风格
};
