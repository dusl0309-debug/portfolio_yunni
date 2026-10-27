// ===== Supabase 연결 정보 (공개 키만 넣는다) =====
const SUPABASE_URL = 'https://mbsewdtplxtujoybffpn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HtTh99O5FYmtaocl8131OQ_tG04Wh46';
const REST_URL = SUPABASE_URL + '/rest/v1/';
const BUCKET = 'resume';

const SESSION_KEY = 'resume_admin_session';
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

// 올릴 수 있는 파일 종류와 새 파일 이름에 붙일 확장자
const IMAGE_TYPES = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};
const FILE_TYPES = { ...IMAGE_TYPES, 'application/pdf': 'pdf' };

const PROFILE_FIELDS = [
  'name', 'title', 'career_badge', 'email', 'phone', 'location',
  'headline', 'intro', 'education', 'skills', 'experience', 'quote',
];

// 화면에 쓰는 값
let session = null;          // { access_token, refresh_token, expires_at, user: { id, email } }
let refreshing = null;
let projects = [];
const likeCounts = new Map();
let guestbookItems = [];

// 프로필 사진: 지금 저장된 주소와 새로 고른 파일
const profilePhoto = { url: null, file: null };
// 카드 편집기: 고치는 카드 id(새 카드면 null)와 파일들
const editor = { id: null, thumbUrl: null, thumbFile: null, fileUrl: null, attachFile: null };

// ===== 작은 도우미 =====
function $(id) {
  return document.getElementById(id);
}

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined && text !== null) node.textContent = text;
  return node;
}

function button(label, className, onClick) {
  const b = el('button', className, label);
  b.type = 'button';
  b.addEventListener('click', () => onClick(b));
  return b;
}

function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch { /* 저장 못 해도 계속 */ }
}

let toastTimer = null;
function showToast(message, isError = false) {
  const t = $('toast');
  t.textContent = message;
  t.classList.toggle('error', isError);
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.hidden = true; }, isError ? 6000 : 3000);
}

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// 버튼을 누르는 동안 잠그고, 문제가 생기면 안내를 띄운다
async function withBusy(btn, work) {
  if (btn.disabled) return;
  btn.disabled = true;
  try {
    await work();
  } catch (err) {
    console.error(err);
    showToast(err.message || '문제가 생겼어요. 다시 시도해 주세요.', true);
  } finally {
    btn.disabled = false;
  }
}

// ===== 로그인 (Supabase Auth) =====
async function authRequest(path, body, token) {
  const headers = { apikey: SUPABASE_KEY, 'Content-Type': 'application/json' };
  if (token) headers.Authorization = 'Bearer ' + token;
  const res = await fetch(SUPABASE_URL + '/auth/v1/' + path, {
    method: 'POST',
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const error = new Error((data && (data.error_description || data.msg || data.message)) || '로그인 요청 실패');
    error.status = res.status;
    throw error;
  }
  return data;
}

function saveSession(data) {
  session = {
    access_token: data.access_token,
    refresh_token: data.refresh_token,
    expires_at: Date.now() + (data.expires_in || 3600) * 1000,
    user: { id: data.user.id, email: data.user.email },
  };
  storageSet(SESSION_KEY, JSON.stringify(session));
}

function clearSession() {
  session = null;
  storageSet(SESSION_KEY, null);
}

async function refreshSession() {
  if (!refreshing) {
    refreshing = authRequest('token?grant_type=refresh_token', { refresh_token: session.refresh_token })
      .then(saveSession)
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

// 요청 전에 토큰이 곧 끝나면 새로 받는다
async function getToken() {
  if (!session) throw sessionExpired();
  if (session.expires_at - Date.now() < 60 * 1000) {
    try {
      await refreshSession();
    } catch {
      throw sessionExpired();
    }
  }
  return session.access_token;
}

function sessionExpired() {
  clearSession();
  showView('login');
  const error = new Error('로그인이 끝났어요. 다시 로그인해 주세요.');
  error.status = 401;
  return error;
}

// ===== Supabase 표 부르기 (로그인 토큰을 붙여서) =====
async function api(path, options = {}) {
  const token = await getToken();
  const headers = {
    apikey: SUPABASE_KEY,
    Authorization: 'Bearer ' + token,
    'Content-Type': 'application/json',
  };
  if (options.prefer) headers.Prefer = options.prefer;
  const res = await fetch(REST_URL + path, {
    method: options.method || 'GET',
    headers,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 401) throw sessionExpired();
  if (!res.ok) {
    const error = new Error(res.status === 403
      ? '권한이 없어요. 관리자 계정인지 확인해 주세요.'
      : '저장하지 못했어요. (오류 ' + res.status + ')');
    error.status = res.status;
    throw error;
  }
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// 고치기·지우기가 실제로 됐는지 돌려받은 줄 수로 확인한다
// (규칙에 막히면 오류 없이 0줄이 돌아온다)
async function apiChange(path, method, body, extraPrefer) {
  const prefer = extraPrefer ? `${extraPrefer},return=representation` : 'return=representation';
  const rows = await api(path, { method, body, prefer });
  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('바뀐 내용이 없어요. 권한이 없거나 이미 지워진 항목일 수 있어요.');
  }
  return rows;
}

async function fetchAll(path) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await api(`${path}&limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// ===== 파일 올리기 (resume 보관함) =====
function checkFile(file, allowed) {
  if (!file) return '';
  if (!allowed[file.type]) {
    return allowed === IMAGE_TYPES
      ? '이미지 파일(PNG, JPG, WEBP, GIF)만 올릴 수 있어요.'
      : '이미지(PNG, JPG, WEBP, GIF)나 PDF 파일만 올릴 수 있어요.';
  }
  if (file.size > MAX_FILE_SIZE) return '10MB가 넘는 파일은 올릴 수 없어요.';
  return '';
}

// 파일 이름은 영어·숫자로 새로 짓는다 (예: projects/20261027-153012-a8f3k2.pdf)
function makeFileName(file) {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const random = Math.random().toString(36).slice(2, 8).replace(/[^a-z0-9]/g, '0');
  return `${stamp}-${random}.${FILE_TYPES[file.type]}`;
}

async function uploadFile(file, folder) {
  const path = `${folder}/${makeFileName(file)}`;
  const token = await getToken();
  const res = await fetch(`${SUPABASE_URL}/storage/v1/object/${BUCKET}/${path}`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: 'Bearer ' + token,
      'Content-Type': file.type,
      'x-upsert': 'false',
    },
    body: file,
  });
  if (!res.ok) {
    throw new Error(res.status === 413
      ? '파일이 너무 커요. 10MB까지 올릴 수 있어요.'
      : '파일을 올리지 못했어요. (오류 ' + res.status + ')');
  }
  return `${SUPABASE_URL}/storage/v1/object/public/${BUCKET}/${path}`;
}

// 파일 칸: 고르면 바로 검사하고, 지금 상태를 글로 보여 준다
function setupFileInput(inputId, allowed, onPick) {
  const input = $(inputId);
  input.addEventListener('change', () => {
    const file = input.files[0] || null;
    const problem = checkFile(file, allowed);
    if (problem) {
      showToast(problem, true);
      input.value = '';
      onPick(null, problem);
      return;
    }
    onPick(file, '');
  });
}

function fileNote(noteId, url, file, problem) {
  const note = $(noteId);
  note.classList.toggle('error', Boolean(problem));
  note.replaceChildren();
  if (problem) {
    note.textContent = problem;
  } else if (file) {
    note.textContent = `새 파일: ${file.name} (저장하면 올라가요)`;
  } else if (url) {
    note.append('지금 파일: ');
    const a = el('a', '', '열어 보기');
    a.href = url;
    a.target = '_blank';
    a.rel = 'noopener';
    note.append(a);
  } else {
    note.textContent = '파일 없음';
  }
}

// ===== 화면 바꾸기 =====
function showView(name) {
  $('loading').hidden = true;
  $('login-view').hidden = name !== 'login';
  $('denied-view').hidden = name !== 'denied';
  $('admin-view').hidden = name !== 'admin';
  $('logout-btn').hidden = name === 'login';
  $('admin-user').hidden = name === 'login';
  if (session) $('admin-user').textContent = session.user.email;
}

async function checkAdminAndStart() {
  const rows = await api(`admins?select=user_id&user_id=eq.${encodeURIComponent(session.user.id)}`);
  if (!rows || rows.length === 0) {
    showView('denied');
    return;
  }
  showView('admin');
  await loadAll();
}

async function onLogin() {
  const email = $('login-email').value.trim();
  const password = $('login-password').value;
  const errorBox = $('login-error');
  errorBox.hidden = true;
  if (!email || !password) {
    errorBox.textContent = '이메일과 비밀번호를 모두 넣어 주세요.';
    errorBox.hidden = false;
    return;
  }
  try {
    const data = await authRequest('token?grant_type=password', { email, password });
    saveSession(data);
    $('login-password').value = '';
    await checkAdminAndStart();
  } catch (err) {
    console.error(err);
    errorBox.textContent = err.status === 400
      ? '이메일이나 비밀번호가 맞지 않아요.'
      : '로그인하지 못했어요. 잠시 후 다시 시도해 주세요.';
    errorBox.hidden = false;
  }
}

async function onLogout() {
  const token = session && session.access_token;
  clearSession();
  showView('login');
  if (token) {
    try { await authRequest('logout', null, token); } catch { /* 이미 끝난 로그인이어도 괜찮다 */ }
  }
}

// ===== 모두 읽기 =====
async function loadAll() {
  const results = await Promise.allSettled([loadProfile(), loadProjects(), loadGuestbook()]);
  const failed = results.find((r) => r.status === 'rejected');
  if (failed && failed.reason.status !== 401) {
    console.error(failed.reason);
    showToast('일부 내용을 불러오지 못했어요. 새로고침해 주세요.', true);
  }
}

// ===== 프로필 =====
async function loadProfile() {
  const rows = await api('profile?select=*&id=eq.1');
  const p = (rows && rows[0]) || {};
  for (const field of PROFILE_FIELDS) $('pf-' + field).value = p[field] || '';
  profilePhoto.url = p.photo_url || null;
  profilePhoto.file = null;
  $('pf-photo-file').value = '';
  renderProfilePhoto();
}

function renderProfilePhoto(problem = '') {
  const img = $('pf-photo-img');
  if (img.dataset.objectUrl) {
    URL.revokeObjectURL(img.dataset.objectUrl);
    delete img.dataset.objectUrl;
  }
  let src = profilePhoto.url;
  if (profilePhoto.file) {
    src = URL.createObjectURL(profilePhoto.file);
    img.dataset.objectUrl = src;
  }
  img.hidden = !src;
  img.onerror = () => { img.hidden = true; };
  if (src) img.src = src;
  else img.removeAttribute('src');
  fileNote('pf-photo-note', profilePhoto.url, profilePhoto.file, problem);
}

async function saveProfile() {
  let photoUrl = profilePhoto.url;
  if (profilePhoto.file) photoUrl = await uploadFile(profilePhoto.file, 'profile');

  const body = { id: 1, photo_url: photoUrl, updated_at: new Date().toISOString() };
  for (const field of PROFILE_FIELDS) body[field] = $('pf-' + field).value.trim();

  // 한 줄뿐이라 있으면 고치고, 없으면 새로 만든다
  await apiChange('profile?on_conflict=id', 'POST', body, 'resolution=merge-duplicates');
  profilePhoto.url = photoUrl;
  profilePhoto.file = null;
  $('pf-photo-file').value = '';
  renderProfilePhoto();
  showToast('프로필을 저장했어요.');
}

// ===== 포트폴리오 카드 =====
async function loadProjects() {
  const [projectRows, likeRows] = await Promise.all([
    api('projects?select=*&order=sort_order.asc,id.asc'),
    fetchAll('likes?select=project_id&order=id.asc'),
  ]);
  projects = projectRows || [];
  likeCounts.clear();
  for (const row of likeRows) {
    likeCounts.set(row.project_id, (likeCounts.get(row.project_id) || 0) + 1);
  }
  renderProjects();
}

function renderProjects() {
  const list = $('pj-list');
  if (projects.length === 0) {
    list.replaceChildren(el('li', 'empty', '아직 카드가 없어요. 위에서 새 카드를 추가해 주세요.'));
    return;
  }
  list.replaceChildren(...projects.map((p, i) => makeProjectRow(p, i)));
}

function makeProjectRow(project, index) {
  const li = el('li', 'admin-row');
  if (project.id === editor.id) li.classList.add('editing');

  const thumb = el('span', 'admin-thumb');
  if (project.thumbnail_url) {
    const img = el('img');
    img.src = project.thumbnail_url;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => img.remove();
    thumb.append(img);
  }

  const main = el('div', 'admin-row-main');
  const meta = [project.number, project.category].filter(Boolean).join(' · ');
  if (meta) main.append(el('span', 'card-meta', meta));
  main.append(el('span', 'admin-row-title', project.title));
  const extra = [`♥ 좋아요 ${likeCounts.get(project.id) || 0}`];
  if (project.file_url) extra.push('첨부 파일 있음');
  main.append(el('span', 'admin-row-sub', extra.join(' · ')));

  const actions = el('div', 'admin-row-actions');
  const up = button('▲ 위로', 'btn-small', (b) => withBusy(b, () => moveProject(index, -1)));
  const down = button('▼ 아래로', 'btn-small', (b) => withBusy(b, () => moveProject(index, 1)));
  up.disabled = index === 0;
  down.disabled = index === projects.length - 1;
  actions.append(
    up,
    down,
    button('수정', 'btn-small', () => startEdit(project)),
    button('좋아요 초기화', 'btn-small', (b) => withBusy(b, () => resetLikes(project))),
    button('삭제', 'btn-small danger', (b) => withBusy(b, () => deleteProject(project)))
  );

  li.append(thumb, main, actions);
  return li;
}

function startEdit(project) {
  editor.id = project.id;
  editor.thumbUrl = project.thumbnail_url || null;
  editor.fileUrl = project.file_url || null;
  editor.thumbFile = null;
  editor.attachFile = null;
  $('pj-editor-title').textContent = `카드 수정: ${project.title}`;
  $('pj-number').value = project.number || '';
  $('pj-category').value = project.category || '';
  $('pj-title').value = project.title || '';
  $('pj-description').value = project.description || '';
  $('pj-tags').value = (project.tags || []).join(', ');
  $('pj-thumb-file').value = '';
  $('pj-attach-file').value = '';
  renderEditorFiles();
  renderProjects();
  $('pj-editor').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function resetEditor() {
  editor.id = null;
  editor.thumbUrl = null;
  editor.fileUrl = null;
  editor.thumbFile = null;
  editor.attachFile = null;
  $('pj-editor-title').textContent = '새 카드 추가';
  for (const id of ['pj-number', 'pj-category', 'pj-title', 'pj-description', 'pj-tags', 'pj-thumb-file', 'pj-attach-file']) {
    $(id).value = '';
  }
  renderEditorFiles();
  renderProjects();
}

function renderEditorFiles() {
  fileNote('pj-thumb-note', editor.thumbUrl, editor.thumbFile);
  fileNote('pj-attach-note', editor.fileUrl, editor.attachFile);
}

async function saveProject() {
  const title = $('pj-title').value.trim();
  if (!title) throw new Error('제목을 적어 주세요.');

  let thumbUrl = editor.thumbUrl;
  let fileUrl = editor.fileUrl;
  if (editor.thumbFile) thumbUrl = await uploadFile(editor.thumbFile, 'projects');
  if (editor.attachFile) fileUrl = await uploadFile(editor.attachFile, 'projects');

  const body = {
    number: $('pj-number').value.trim(),
    category: $('pj-category').value.trim(),
    title,
    description: $('pj-description').value.trim(),
    tags: $('pj-tags').value.split(',').map((t) => t.trim()).filter(Boolean),
    thumbnail_url: thumbUrl,
    file_url: fileUrl,
  };

  if (editor.id === null) {
    // 새 카드는 맨 뒤에 붙인다
    body.sort_order = projects.reduce((max, p) => Math.max(max, p.sort_order), 0) + 1;
    await apiChange('projects', 'POST', body);
    showToast('새 카드를 추가했어요.');
  } else {
    await apiChange(`projects?id=eq.${editor.id}`, 'PATCH', body);
    showToast('카드를 고쳤어요.');
  }
  resetEditor();
  await loadProjects();
}

// 순서를 바꾼 뒤 1, 2, 3… 으로 다시 매기고, 달라진 카드만 저장한다
async function moveProject(index, step) {
  const target = index + step;
  if (target < 0 || target >= projects.length) return;
  const ordered = [...projects];
  [ordered[index], ordered[target]] = [ordered[target], ordered[index]];
  const changes = ordered
    .map((p, i) => ({ p, order: i + 1 }))
    .filter(({ p, order }) => p.sort_order !== order);
  for (const { p, order } of changes) {
    await apiChange(`projects?id=eq.${p.id}`, 'PATCH', { sort_order: order });
  }
  await loadProjects();
}

async function deleteProject(project) {
  if (!confirm(`"${project.title}" 카드를 지울까요?\n이 카드의 좋아요도 함께 지워지고, 되돌릴 수 없어요.`)) return;
  await apiChange(`projects?id=eq.${project.id}`, 'DELETE');
  if (editor.id === project.id) resetEditor();
  showToast('카드를 지웠어요.');
  await loadProjects();
}

async function resetLikes(project) {
  const n = likeCounts.get(project.id) || 0;
  if (n === 0) {
    showToast('이 카드는 좋아요가 0개예요.');
    return;
  }
  if (!confirm(`"${project.title}" 카드의 좋아요 ${n}개를 모두 지울까요?\n되돌릴 수 없어요.`)) return;
  await apiChange(`likes?project_id=eq.${project.id}`, 'DELETE');
  showToast('좋아요를 초기화했어요.');
  await loadProjects();
}

// ===== 방명록 =====
async function loadGuestbook() {
  guestbookItems = await fetchAll('resume_guestbook?select=*&order=created_at.desc,id.desc');
  renderGuestbook();
}

function renderGuestbook() {
  const list = $('gb-list');
  if (guestbookItems.length === 0) {
    list.replaceChildren(el('li', 'empty', '방명록 글이 없어요.'));
    return;
  }
  list.replaceChildren(...guestbookItems.map((item) => {
    const li = el('li', 'admin-row');
    const main = el('div', 'admin-row-main');
    const head = el('div', 'guest-head');
    head.append(el('span', 'guest-nick', item.nickname), el('span', 'guest-date', formatDate(item.created_at)));
    main.append(head, el('p', 'guest-msg', item.message));
    const actions = el('div', 'admin-row-actions');
    actions.append(button('삭제', 'btn-small danger', (b) => withBusy(b, () => deleteGuest(item))));
    li.append(main, actions);
    return li;
  }));
}

async function deleteGuest(item) {
  if (!confirm(`${item.nickname}님의 글을 지울까요?\n"${item.message}"\n되돌릴 수 없어요.`)) return;
  await apiChange(`resume_guestbook?id=eq.${item.id}`, 'DELETE');
  guestbookItems = guestbookItems.filter((g) => g.id !== item.id);
  renderGuestbook();
  showToast('글을 지웠어요.');
}

// ===== 버튼 연결과 시작 =====
function setup() {
  $('login-btn').addEventListener('click', onLogin);
  for (const id of ['login-email', 'login-password']) {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        onLogin();
      }
    });
  }
  $('logout-btn').addEventListener('click', onLogout);

  setupFileInput('pf-photo-file', IMAGE_TYPES, (file, problem) => {
    profilePhoto.file = file;
    renderProfilePhoto(problem);
  });
  $('pf-photo-clear').addEventListener('click', () => {
    profilePhoto.url = null;
    profilePhoto.file = null;
    $('pf-photo-file').value = '';
    renderProfilePhoto();
    showToast('사진을 뺐어요. "프로필 저장"을 눌러야 반영돼요.');
  });
  $('pf-save').addEventListener('click', (e) => withBusy(e.currentTarget, saveProfile));

  setupFileInput('pj-thumb-file', IMAGE_TYPES, (file, problem) => {
    editor.thumbFile = file;
    fileNote('pj-thumb-note', editor.thumbUrl, file, problem);
  });
  setupFileInput('pj-attach-file', FILE_TYPES, (file, problem) => {
    editor.attachFile = file;
    fileNote('pj-attach-note', editor.fileUrl, file, problem);
  });
  $('pj-thumb-clear').addEventListener('click', () => {
    editor.thumbUrl = null;
    editor.thumbFile = null;
    $('pj-thumb-file').value = '';
    renderEditorFiles();
  });
  $('pj-attach-clear').addEventListener('click', () => {
    editor.fileUrl = null;
    editor.attachFile = null;
    $('pj-attach-file').value = '';
    renderEditorFiles();
  });
  $('pj-save').addEventListener('click', (e) => withBusy(e.currentTarget, saveProject));
  $('pj-cancel').addEventListener('click', resetEditor);

  renderEditorFiles();
}

async function init() {
  setup();
  try {
    session = JSON.parse(storageGet(SESSION_KEY) || 'null');
  } catch {
    session = null;
  }
  if (!session || !session.refresh_token || !session.user) {
    clearSession();
    showView('login');
    return;
  }
  try {
    await checkAdminAndStart();
  } catch (err) {
    console.error(err);
    if (err.status !== 401) {
      showView('login');
      showToast('불러오지 못했어요. 다시 로그인해 주세요.', true);
    }
  }
}

init();
