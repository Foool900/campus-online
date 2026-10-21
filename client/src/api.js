// 统一封装 fetch：自动 JSON 解析、把后端错误信息抛给调用方
async function request(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    data = {};
  }
  if (!res.ok) {
    const err = new Error(data?.error || `请求失败（HTTP ${res.status}）`);
    err.status = res.status;
    throw err;
  }
  return data;
}

export const api = {
  health: () => request('/api/health'),
  campuses: () => request('/api/campuses'),
  areas: (campusId) =>
    request('/api/areas' + (campusId ? `?campusId=${encodeURIComponent(campusId)}` : '')),
  moveArea: (id, body) => request(`/api/areas/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  channels: (areaId) => request(`/api/areas/${areaId}/channels`),
  messages: (channelId) => request(`/api/channels/${channelId}/messages`),
  sendMessage: (channelId, body) =>
    request(`/api/channels/${channelId}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  posts: (channelId) => request(`/api/channels/${channelId}/posts`),
  createPost: (channelId, body) =>
    request(`/api/channels/${channelId}/posts`, { method: 'POST', body: JSON.stringify(body) }),
  todos: (userId) => request(`/api/todos?userId=${encodeURIComponent(userId)}`),
  createTodo: (body) => request('/api/todos', { method: 'POST', body: JSON.stringify(body) }),
  completeTodo: (id, body) =>
    request(`/api/todos/${id}/complete`, { method: 'PATCH', body: JSON.stringify(body) }),
  user: (id) => request(`/api/users/${id}`),
  leaderboard: () => request('/api/leaderboard'),
  createUser: (body) => request('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id, body) =>
    request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  achievements: (userId) => request(`/api/achievements?userId=${encodeURIComponent(userId)}`),
  world: () => request('/api/world'),
};

export default api;
