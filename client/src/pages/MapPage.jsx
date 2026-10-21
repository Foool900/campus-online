import { useEffect, useState } from 'react';
import { api } from '../api.js';
import HeDaMap from '../components/HeDaMap.jsx';
import AreaDialog from '../components/AreaDialog.jsx';

export default function MapPage() {
  const [campuses, setCampuses] = useState([]);
  const [campusId, setCampusId] = useState(null);
  const [areas, setAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState(null);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    api
      .campuses()
      .then((cs) => {
        setCampuses(cs);
        if (cs.length) setCampusId(cs[0].id);
      })
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!campusId) return;
    setAreas([]);
    setSelectedArea(null);
    api
      .areas(campusId)
      .then(setAreas)
      .catch((e) => setError(e.message));
  }, [campusId]);

  const moveArea = async (areaId, x, y) => {
    // 本地先更新，拖拽即时反馈
    setAreas((prev) => prev.map((a) => (a.id === areaId ? { ...a, x, y } : a)));
    try {
      await api.moveArea(areaId, { x, y });
    } catch (e) {
      setError(e.message);
    }
  };

  const activeCampus = campuses.find((c) => c.id === campusId);

  return (
    <div className="map-page">
      <div className="page-head">
        <h1>🗺️ 校园地图</h1>
        <p>切换校区，点击地点符号进入该区域的频道</p>
      </div>

      <div className="map-toolbar">
        <div className="campus-tabs">
          {campuses.map((c) => (
            <button
              key={c.id}
              className={'campus-tab' + (c.id === campusId ? ' active' : '')}
              onClick={() => setCampusId(c.id)}
            >
              {c.name}
            </button>
          ))}
        </div>
        <button className={'btn ' + (editing ? 'success' : 'ghost')} onClick={() => setEditing(!editing)}>
          {editing ? '✅ 完成调整' : '✏️ 调整标记位置'}
        </button>
      </div>

      {editing && (
        <div className="hint-banner">拖动地图上的标记到正确位置，松手自动保存；调整完点「完成调整」。</div>
      )}
      {error && <div className="error-banner">{error}</div>}

      <div className="map-container">
        <HeDaMap
          campus={activeCampus}
          areas={areas}
          onSelectArea={setSelectedArea}
          selectedAreaId={selectedArea?.id}
          editable={editing}
          onMove={moveArea}
        />
      </div>

      {selectedArea && <AreaDialog area={selectedArea} onClose={() => setSelectedArea(null)} />}
    </div>
  );
}
