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
  recallChannelMessage: (channelId, messageId, body) =>
    request(`/api/channels/${channelId}/messages/${messageId}/recall`, { method: 'POST', body: JSON.stringify(body) }),
  reactChannelMessage: (channelId, messageId, body) =>
    request(`/api/channels/${channelId}/messages/${messageId}/react`, { method: 'POST', body: JSON.stringify(body) }),
  channelMessageReads: (channelId, messageId) => request(`/api/channels/${channelId}/messages/${messageId}/reads`),
  markChannelRead: (channelId, body) =>
    request(`/api/channels/${channelId}/read`, { method: 'POST', body: JSON.stringify(body) }),
  posts: (channelId, userId) =>
    request(`/api/channels/${channelId}/posts` + (userId ? `?userId=${encodeURIComponent(userId)}` : '')),
  createPost: (channelId, body) =>
    request(`/api/channels/${channelId}/posts`, { method: 'POST', body: JSON.stringify(body) }),
  post: (id, userId) =>
    request(`/api/posts/${id}` + (userId ? `?userId=${encodeURIComponent(userId)}` : '')),
  joinPost: (id, body) =>
    request(`/api/posts/${id}/join`, { method: 'POST', body: JSON.stringify(body) }),
  postMessages: (id) => request(`/api/posts/${id}/messages`),
  sendPostMessage: (id, body) =>
    request(`/api/posts/${id}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  postNotes: (id, userId) =>
    request(`/api/posts/${id}/notes` + (userId ? `?userId=${encodeURIComponent(userId)}` : '')),
  addNote: (id, body) =>
    request(`/api/posts/${id}/notes`, { method: 'POST', body: JSON.stringify(body) }),
  updateStatus: (id, body) =>
    request(`/api/posts/${id}/status`, { method: 'PATCH', body: JSON.stringify(body) }),
  recallMessage: (postId, messageId, body) =>
    request(`/api/posts/${postId}/messages/${messageId}/recall`, { method: 'POST', body: JSON.stringify(body) }),
  reactMessage: (postId, messageId, body) =>
    request(`/api/posts/${postId}/messages/${messageId}/react`, { method: 'POST', body: JSON.stringify(body) }),
  messageReads: (postId, messageId) => request(`/api/posts/${postId}/messages/${messageId}/reads`),
  markRead: (postId, body) => request(`/api/posts/${postId}/read`, { method: 'POST', body: JSON.stringify(body) }),
  stickers: (userId) => request(`/api/stickers?userId=${encodeURIComponent(userId)}`),
  deleteSticker: (id, userId) =>
    request(`/api/stickers/${id}?userId=${encodeURIComponent(userId)}`, { method: 'DELETE' }),
  // 上传表情包用原始二进制（非 JSON），单独封装
  uploadSticker: async (userId, file) => {
    const res = await fetch(`/api/stickers?userId=${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers: { 'Content-Type': file.type },
      body: file,
    });
    let data = null;
    try {
      data = await res.json();
    } catch {
      data = {};
    }
    if (!res.ok) {
      const err = new Error(data?.error || `上传失败（HTTP ${res.status}）`);
      err.status = res.status;
      throw err;
    }
    return data;
  },
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
