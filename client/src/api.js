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
    if (data?.code) err.code = data.code;
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
    const token = typeof localStorage !== 'undefined' ? localStorage.getItem('campus_token') : null;
    const headers = { 'Content-Type': file.type };
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await fetch(`/api/stickers?userId=${encodeURIComponent(userId)}`, {
      method: 'POST',
      headers,
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
  // 任务系统
  tasks: (filter, status) =>
    request(`/api/tasks?filter=${encodeURIComponent(filter)}` + (status ? `&status=${encodeURIComponent(status)}` : '')),
  createTask: (body) => request('/api/tasks', { method: 'POST', body: JSON.stringify(body) }),
  task: (id) => request(`/api/tasks/${id}`),
  acceptTask: (id) => request(`/api/tasks/${id}/accept`, { method: 'POST' }),
  submitTask: (id, body) => request(`/api/tasks/${id}/submit`, { method: 'POST', body: JSON.stringify(body) }),
  approveTask: (id) => request(`/api/tasks/${id}/approve`, { method: 'POST' }),
  rejectTask: (id) => request(`/api/tasks/${id}/reject`, { method: 'POST' }),
  cancelTask: (id) => request(`/api/tasks/${id}/cancel`, { method: 'POST' }),
  abandonTask: (id) => request(`/api/tasks/${id}/abandon`, { method: 'POST' }),
  toggleTaskDone: (id) => request(`/api/tasks/${id}/toggle-done`, { method: 'PATCH' }),
  taskMessages: (id) => request(`/api/tasks/${id}/messages`),
  sendTaskMessage: (id, body) =>
    request(`/api/tasks/${id}/messages`, { method: 'POST', body: JSON.stringify(body) }),
  recallTaskMessage: (id, mid, body) =>
    request(`/api/tasks/${id}/messages/${mid}/recall`, { method: 'POST', body: JSON.stringify(body) }),
  reactTaskMessage: (id, mid, body) =>
    request(`/api/tasks/${id}/messages/${mid}/react`, { method: 'POST', body: JSON.stringify(body) }),
  taskMessageReads: (id, mid) => request(`/api/tasks/${id}/messages/${mid}/reads`),
  markTaskRead: (id, body) =>
    request(`/api/tasks/${id}/read`, { method: 'POST', body: JSON.stringify(body) }),
  // 钱包 / 金币配置
  wallet: () => request('/api/coin/wallet'),
  coinConfig: () => request('/api/coin/config'),
  signinStatus: () => request('/api/signin'),
  signinClaim: () => request('/api/signin', { method: 'POST' }),
  marketSession: () => request('/api/market/session'),
  marketShops: () => request('/api/market/shops'),
  marketStalls: (sessionId) => request(`/api/market/stalls?sessionId=${encodeURIComponent(sessionId || '')}`),
  marketItems: (sessionId) => request(`/api/market/items?sessionId=${encodeURIComponent(sessionId || '')}`),
  marketMyOrders: () => request('/api/market/orders/mine'),
  marketBargains: () => request('/api/market/bargains/mine'),
  marketCreateItem: (body) => request('/api/market/items', { method: 'POST', body: JSON.stringify(body) }),
  marketListItem: (id, body) => request(`/api/market/items/${id}/list`, { method: 'POST', body: JSON.stringify(body) }),
  marketRemoveItem: (id) => request(`/api/market/items/${id}/remove`, { method: 'POST' }),
  marketBuy: (id) => request(`/api/market/items/${id}/buy`, { method: 'POST' }),
  marketSignupStall: (sessionId) => request('/api/market/stalls/signup', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  marketGrabStall: (sessionId) => request('/api/market/stalls/grab', { method: 'POST', body: JSON.stringify({ sessionId }) }),
  marketConfirmStall: (id) => request(`/api/market/stalls/${id}/confirm`, { method: 'POST' }),
  marketReleaseStall: (id) => request(`/api/market/stalls/${id}/release`, { method: 'POST' }),
  marketBargain: (itemId, offerCoin) => request(`/api/market/items/${itemId}/bargains`, { method: 'POST', body: JSON.stringify({ offerCoin }) }),
  marketAcceptBargain: (id) => request(`/api/market/bargains/${id}/accept`, { method: 'POST' }),
  marketRejectBargain: (id) => request(`/api/market/bargains/${id}/reject`, { method: 'POST' }),
  marketPayOrder: (id) => request(`/api/market/orders/${id}/pay`, { method: 'POST' }),
  marketDeliverOrder: (id) => request(`/api/market/orders/${id}/deliver`, { method: 'POST' }),
  marketConfirmOrder: (id) => request(`/api/market/orders/${id}/confirm`, { method: 'POST' }),
  marketOpenBlindbox: (id) => request(`/api/market/orders/${id}/open`, { method: 'POST' }),
  lotteryInfo: () => request('/api/lottery'),
  lotteryDraw: () => request('/api/lottery/draw', { method: 'POST' }),
  adminSearchUsers: (q) => request(`/api/admin/users/search?q=${encodeURIComponent(q)}`),
  adminGrantCoin: (id, body) => request(`/api/admin/user/${id}/coin`, { method: 'PATCH', body: JSON.stringify(body) }),
  adminSetPermissions: (id, body) => request(`/api/admin/user/${id}/permissions`, { method: 'PATCH', body: JSON.stringify(body) }),
  user: (id) => request(`/api/users/${id}`),
  leaderboard: () => request('/api/leaderboard'),
  createUser: (body) => request('/api/users', { method: 'POST', body: JSON.stringify(body) }),
  updateUser: (id, body) =>
    request(`/api/users/${id}`, { method: 'PATCH', body: JSON.stringify(body) }),
  achievements: (userId) => request(`/api/achievements?userId=${encodeURIComponent(userId)}`),
  userAchievements: () => request('/api/user/achievements'),
  triggerAchievement: (code) => request('/api/user/achievements/trigger', { method: 'POST', body: JSON.stringify({ code }) }),
  world: () => request('/api/world'),
};

export default api;
