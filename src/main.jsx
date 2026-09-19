import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';
import { useStore } from './lib/store.js';
import ExhibitBuilder from './components/ExhibitBuilder.jsx';
import Ledger from './components/Ledger.jsx';

function App() {
  const store = useStore();
  const [module, setModule] = useState('ledger');

  return (
    <div className="app">
      <aside>
        <div className="brand"><span className="mark">M</span><span>展览工作台</span></div>
        <div className="side-label">当前项目</div>
        <div className="project">
          <span className="project-dot"></span>
          <div><strong>潮汐之后</strong><small>2024 春季展</small></div>
          <span>⌄</span>
        </div>
        <nav>
          <button className={module === 'exhibits' ? 'active' : ''} onClick={() => setModule('exhibits')}>
            ▧ <span>展项内容</span><b>{store.exhibits.length}</b>
          </button>
          <button className={module === 'ledger' ? 'active' : ''} onClick={() => setModule('ledger')}>
            ▤ <span>导览机台账</span><b>{store.devices.length}</b>
          </button>
          <button>⌁ <span>展厅动线</span></button>
          <button>◉ <span>二维码</span></button>
        </nav>
        <div className="side-foot">
          <button>⚙ 设置</button>
          <small>台账已自动保存 · 重新加载后状态一致</small>
        </div>
      </aside>
      <main className="workspace">
        {module === 'exhibits' ? (
          <ExhibitBuilder exhibits={store.exhibits} loans={store.loans} patch={store.patch} />
        ) : (
          <Ledger
            devices={store.devices} exhibits={store.exhibits} loans={store.loans}
            repairs={store.repairs} shifts={store.shifts} patch={store.patch} reset={store.reset}
          />
        )}
      </main>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
