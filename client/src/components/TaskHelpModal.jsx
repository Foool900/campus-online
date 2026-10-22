// 任务系统帮助弹窗（用户向使用说明，完整版见仓库 TASKS.md）
export default function TaskHelpModal({ onClose }) {
  return (
    <div className="act-pop-overlay" onClick={onClose}>
      <div className="task-help-card" onClick={(e) => e.stopPropagation()}>
        <div className="task-help-head">
          <span>📖 任务系统帮助</span>
          <button className="task-help-close" onClick={onClose} aria-label="关闭">×</button>
        </div>

        <div className="task-help-body">
          <h3>两类任务</h3>
          <ul>
            <li><b>公开任务</b>：所有人可见可接取，发布时冻结经验奖励，验收通过后划转给接取者。</li>
            <li><b>私密备忘</b>：仅自己可见，无经验，可完成打卡、设截止时间和标签。</li>
          </ul>

          <h3>经验钱包</h3>
          <ul>
            <li><b>累计经验</b>：只增不减，决定等级（Lv = 累计经验 ÷ 100 + 1）。</li>
            <li><b>可用经验</b>：可托管、可支配。</li>
            <li><b>冻结经验</b>：发布公开任务后被托管的部分，任务结束才退回或划转。</li>
          </ul>

          <h3>公开任务流程</h3>
          <ul>
            <li>发布（冻结奖励）→ 接取 → 提交凭证 → 发布者验收通过（经验划转给接取者）。</li>
            <li>自己不能接自己发布的任务。</li>
            <li>提交需附凭证：文本 / 图片链接 / 链接，至少一项。</li>
            <li>任务发布后 <b>10 分钟</b>内不能提交。</li>
            <li>被驳回可重新提交；累计驳回 <b>3 次</b>任务终止，经验退回。</li>
            <li>到期 / 取消任务，冻结经验退回发布者。</li>
          </ul>

          <h3>讨论区</h3>
          <ul>
            <li>发布者与接取者可发言，其他人接取后可参与。</li>
            <li>任务进入终态（通过 / 终止 / 过期 / 取消）后只读。</li>
            <li>支持文本、@、表情、表情包、回复、撤回。</li>
          </ul>

          <h3>每日上限</h3>
          <ul>
            <li>单任务奖励 ≤ min(可用经验 × 20%，500)。</li>
            <li>每日可发公开任务 5 个；发布经验额度按等级分档。</li>
            <li>每日接取获得经验 300；同一对用户经验往来 3 次。</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
