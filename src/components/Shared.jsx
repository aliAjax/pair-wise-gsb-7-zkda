import React from 'react';

const RULE_NAME = {
  R1: 'R1 · 展项未发布',
  R2: 'R2 · 设备维修中',
  R3: 'R3 · 同时段重复绑定',
  R4: 'R4 · 电量不足',
  R5: 'R5 · 撤展未释放设备',
  R6: 'R6 · 借还/维修链断裂',
};

// 冲突时列出：设备、展项、借出时段、触发规则
export function ConflictBanner({ conflicts, title = '操作被规则拦截', onClose }) {
  if (!conflicts?.length) return null;
  return (
    <div className="conflict-box">
      <div className="conflict-head">
        <strong>⚠ {title}</strong>
        {onClose && <button onClick={onClose}>×</button>}
      </div>
      <ul>
        {conflicts.map((c, i) => (
          <li key={i}>
            <div className="conflict-rule">{RULE_NAME[c.rule] || c.rule}</div>
            <div className="conflict-grid">
              <span><small>设备</small><b>{c.device}</b></span>
              <span><small>展项</small><b>{c.exhibit}</b></span>
              <span className="wide"><small>借出时段 / 现场</small><b>{c.period}</b></span>
            </div>
            <p>{c.message}</p>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function Modal({ title, children, onClose }) {
  return (
    <div className="modal-mask" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button onClick={onClose}>×</button>
        </div>
        {children}
      </div>
    </div>
  );
}
