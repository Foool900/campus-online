import { useEffect, useState } from 'react';
import { api } from '../api.js';

// 地图数据（校区 / 区域 / 选中区域 / 编辑标记）：桌面 HUD 与手机首页共用，
// 避免在 Layout 与 MobileAppShell 各写一份加载逻辑。
export default function useMapData() {
  const [campuses, setCampuses] = useState([]);
  const [campusId, setCampusId] = useState(null);
  const [areas, setAreas] = useState([]);
  const [selectedArea, setSelectedArea] = useState(null);
  const [editing, setEditing] = useState(false); // 编辑标记（桌面端拖拽节点占位）
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

  const activeCampus = campuses.find((c) => c.id === campusId);

  return {
    campuses,
    campusId,
    setCampusId,
    areas,
    selectedArea,
    setSelectedArea,
    editing,
    setEditing,
    activeCampus,
    error,
  };
}
