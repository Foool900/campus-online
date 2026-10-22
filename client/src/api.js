// 统一封装 fetch：自动 JSON 解析、自动带 token、把后端错误信息抛给调用方
async function request(path, options = {}) {
  const token = typeof localStorage !== 'undefined' ? localStorage.getItem('campus_token') : null;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(path, { ...options, headers });
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
  authRegister: (body) => request('/api/auth/register', { method: 'POST', body: JSON.stringify(body) }),
  authLogin: (body) => request('/api/auth/login', { method: 'POST', body: JSON.stringify(body) }),
  authSetPassword: (body) => request('/api/auth/set-password', { method: 'POST', body: JSON.stringify(body) }),
  authLogout: () => request('/api/auth/logout', { method: 'POST' }),
  authMe: () => request('/api/auth/me'),
  verificationUpload: async (file) => {
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('campus_token') : null;
    const headers = { 'Content-Type': file.type };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch('/api/verification/upload', { method: 'POST', headers, body: file });
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
  verificationMe: () => request('/api/verification/me'),
  submitVerification: (body) => request('/api/verification', { method: 'POST', body: JSON.stringify(body) }),
  verificationPending: () => request('/api/verification/pending'),
  approveVerification: (id) => request(`/api/verification/${id}/approve`, { method: 'POST' }),
  rejectVerification: (id, body) => request(`/api/verification/${id}/reject`, { method: 'POST', body: JSON.stringify(body) }),
  adminList: () => request('/api/admin'),
  promoteAdmin: (body) => request('/api/admin', { method: 'POST', body: JSON.stringify(body) }),
  removeAdmin: (id) => request(`/api/admin/${id}`, { method: 'DELETE' }),
  searchUsers: (q) => request(`/api/friends/search?q=${encodeURIComponent(q)}`),
  friendRequest: (friendId, message) =>
    request('/api/friends/request', { method: 'POST', body: JSON.stringify({ friendId, message }) }),
  friendRequests: () => request('/api/friends/requests'),
  acceptFriendRequest: (id) => request(`/api/friends/requests/${id}/accept`, { method: 'POST' }),
  rejectFriendRequest: (id) => request(`/api/friends/requests/${id}/reject`, { method: 'POST' }),
  friends: () => request('/api/friends'),
  removeFriend: (id) => request(`/api/friends/${id}`, { method: 'DELETE' }),
  conversations: () => request('/api/conversations'),
  createDirectConversation: (friendId) =>
    request('/api/conversations/direct', { method: 'POST', body: JSON.stringify({ friendId }) }),
  conversation: (id) => request(`/api/conversations/${id}`),
  conversationMessages: (id) => request(`/api/conversations/${id}/messages`),
  sendConversationMessage: (id, body) =>
    request(`/api/conversations/${id}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  recallConversationMessage: (id, mid, body) =>
    request(`/api/conversations/${id}/messages/${mid}/recall`, { method: 'POST', body: JSON.stringify(body) }),
  reactConversationMessage: (id, mid, body) =>
    request(`/api/conversations/${id}/messages/${mid}/react`, { method: 'POST', body: JSON.stringify(body) }),
  conversationMessageReads: (id, mid) => request(`/api/conversations/${id}/messages/${mid}/reads`),
  markConversationRead: (id, body) =>
    request(`/api/conversations/${id}/read`, { method: 'POST', body: JSON.stringify(body) }),
  createGroup: (body) => request('/api/conversations/group', { method: 'POST', body: JSON.stringify(body) }),
  addGroupMembers: (id, body) => request(`/api/conversations/${id}/members`, { method: 'POST', body: JSON.stringify(body) }),
  removeGroupMember: (id, userId) => request(`/api/conversations/${id}/members/${userId}`, { method: 'DELETE' }),
  renameGroup: (id, body) => request(`/api/conversations/${id}/name`, { method: 'PATCH', body: JSON.stringify(body) }),
  dissolveGroup: (id) => request(`/api/conversations/${id}`, { method: 'DELETE' }),
  conversationUnread: () => request('/api/conversations/unread'),
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
