// ===== Supabase 연결 정보 (공개 키만 넣는다) =====
const SUPABASE_URL = 'https://mbsewdtplxtujoybffpn.supabase.co';
const SUPABASE_KEY = 'sb_publishable_HtTh99O5FYmtaocl8131OQ_tG04Wh46';
const REST_URL = SUPABASE_URL + '/rest/v1/';

// 브라우저에 저장해 두는 이름
const CLIENT_ID_KEY = 'resume_client_id';
const LIKED_KEY = 'resume_liked_projects';

// 화면에 쓰는 값
let projects = [];
const likeCounts = new Map();   // 카드 id → 좋아요 수
let likedIds = new Set();       // 이 브라우저가 이미 누른 카드 id
let guestbookItems = [];

const HEART_SVG =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20s-7-4.4-9.2-9A5 5 0 0 1 12 5.5 5 5 0 0 1 21.2 11C19 15.6 12 20 12 20z"/></svg>';

// ===== Supabase 부르기 =====
async function api(path, options = {}) {
  const res = await fetch(REST_URL + path, {
    method: options.method || 'GET',
    headers: {
      apikey: SUPABASE_KEY,
      'Content-Type': 'application/json',
      ...(options.headers || {}),
    },
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const error = new Error('Supabase 요청 실패: ' + res.status);
    error.status = res.status;
    throw error;
  }
  if (res.status === 204) return null;
  const text = await res.text();
  return text ? JSON.parse(text) : null;
}

// 한 번에 1000줄까지만 오므로, 끝까지 나눠서 모두 읽는다
async function fetchAll(path) {
  const pageSize = 1000;
  const rows = [];
  for (let offset = 0; ; offset += pageSize) {
    const page = await api(`${path}&limit=${pageSize}&offset=${offset}`);
    rows.push(...page);
    if (page.length < pageSize) return rows;
  }
}

// ===== 브라우저 저장소 (막혀 있어도 화면은 동작하게) =====
function storageGet(key) {
  try { return localStorage.getItem(key); } catch { return null; }
}

function storageSet(key, value) {
  try { localStorage.setItem(key, value); } catch { /* 저장 못 해도 계속 */ }
}

function makeRandomId() {
  if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 12);
}

function getClientId() {
  let id = storageGet(CLIENT_ID_KEY);
  if (!id || id.length < 8 || id.length > 64) {
    id = makeRandomId();
    storageSet(CLIENT_ID_KEY, id);
  }
  return id;
}

const clientId = getClientId();

function loadLikedIds() {
  try {
    const saved = JSON.parse(storageGet(LIKED_KEY) || '[]');
    return new Set(Array.isArray(saved) ? saved : []);
  } catch {
    return new Set();
  }
}

function saveLikedIds() {
  storageSet(LIKED_KEY, JSON.stringify([...likedIds]));
}

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

// http/https 주소만 연다 (이상한 주소는 무시)
function safeUrl(value) {
  if (!value) return null;
  try {
    const url = new URL(value, location.href);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
}

function showStatus(message) {
  const box = $('status');
  box.textContent = message;
  box.hidden = false;
}

function formatDate(value) {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function splitLines(text) {
  return (text || '').split('\n').map((s) => s.trim()).filter(Boolean);
}

// ===== 프로필 =====
function renderProfile(p) {
  document.title = p.name ? `${p.name} | 포트폴리오` : '포트폴리오';

  const img = $('photo-img');
  const photo = safeUrl(p.photo_url);
  if (photo) {
    img.src = photo;
    img.hidden = false;
    img.onerror = () => { img.hidden = true; };
  } else {
    img.hidden = true;
  }

  $('name').textContent = p.name;
  $('role').textContent = p.title;
  $('badge').textContent = p.career_badge;
  $('badge').hidden = !p.career_badge;

  $('c-name').textContent = p.name;

  const email = $('c-email');
  email.textContent = p.email;
  if (p.email) email.href = 'mailto:' + p.email;
  else email.removeAttribute('href');

  const phone = $('c-phone');
  phone.textContent = p.phone;
  if (p.phone) phone.href = 'tel:' + p.phone.replace(/[^0-9+]/g, '');
  else phone.removeAttribute('href');

  $('c-location').textContent = p.location;

  renderHeadline(p.headline, p.name);
  $('intro').textContent = p.intro;

  const education = $('education');
  education.replaceChildren(...splitLines(p.education).map((line) => el('p', '', line)));

  const skills = $('skills');
  const skillList = (p.skills || '').split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
  skills.replaceChildren(...skillList.map((s) => el('span', 'chip', s)));

  const experience = $('experience');
  experience.replaceChildren(...splitLines(p.experience).map((line) => el('p', '', line)));

  $('quote').textContent = p.quote ? `“${p.quote}”` : '';
  $('quote').hidden = !p.quote;
}

// 한 줄 소개 안의 이름에만 파란 밑줄
function renderHeadline(headline, name) {
  const box = $('headline');
  box.replaceChildren();
  const text = headline || '';
  const at = name ? text.indexOf(name) : -1;
  if (at < 0) {
    box.textContent = text;
    return;
  }
  box.append(
    text.slice(0, at),
    el('span', 'hl', name),
    text.slice(at + name.length)
  );
}

// ===== 포트폴리오 카드 =====
function renderCards() {
  const box = $('cards');
  if (projects.length === 0) {
    box.replaceChildren(el('p', 'empty', '아직 등록된 프로젝트가 없습니다.'));
    return;
  }
  box.replaceChildren(...projects.map(makeCard));
}

function makeCard(project) {
  const card = el('article', 'card');

  // 카드 위쪽(썸네일·글)을 누르면 파일이나 이미지를 새 탭으로 연다
  const open = el('button', 'card-open');
  open.type = 'button';
  const target = safeUrl(project.file_url) || safeUrl(project.thumbnail_url);
  if (target) {
    open.addEventListener('click', () => {
      window.open(target, '_blank', 'noopener');
    });
    open.title = '새 탭에서 열기';
  } else {
    open.disabled = true;
  }

  const thumb = el('span', 'thumb');
  const bar = el('span', 'thumb-bar');
  bar.append(el('span', 'thumb-dot'), el('span', 'thumb-dot'), el('span', 'thumb-dot'));
  const view = el('span', 'thumb-view');
  const thumbUrl = safeUrl(project.thumbnail_url);
  if (thumbUrl) {
    const img = el('img');
    img.src = thumbUrl;
    img.alt = '';
    img.loading = 'lazy';
    img.onerror = () => img.remove();
    view.append(img);
  }
  thumb.append(bar, view);

  const body = el('span', 'card-body');
  const meta = [project.number, project.category].filter(Boolean).join(' · ');
  if (meta) body.append(el('span', 'card-meta', meta));
  body.append(el('span', 'card-title', project.title));
  if (project.description) body.append(el('span', 'card-desc', project.description));
  const tagList = Array.isArray(project.tags) ? project.tags.filter(Boolean) : [];
  if (tagList.length) {
    const tags = el('span', 'tags');
    tags.append(...tagList.map((t) => el('span', 'tag', t)));
    body.append(tags);
  }

  open.append(thumb, body);

  // 좋아요 버튼 (카드 여는 버튼과 따로)
  const foot = el('div', 'card-foot');
  const like = el('button', 'like-btn');
  like.type = 'button';
  like.innerHTML = HEART_SVG;
  const count = el('span', 'like-count');
  like.append(count);
  updateLikeButton(like, count, project.id);
  like.addEventListener('click', () => onLike(project.id, like, count));
  foot.append(like);

  card.append(open, foot);
  return card;
}

function updateLikeButton(button, countNode, projectId) {
  const liked = likedIds.has(projectId);
  const n = likeCounts.get(projectId) || 0;
  countNode.textContent = n;
  button.classList.toggle('liked', liked);
  button.setAttribute('aria-pressed', liked ? 'true' : 'false');
  button.setAttribute('aria-label', `좋아요 ${n}개${liked ? ' (이미 눌렀어요)' : ''}`);
}

async function onLike(projectId, button, countNode) {
  if (likedIds.has(projectId) || button.dataset.busy) return;
  button.dataset.busy = '1';

  // 먼저 화면에서 숫자를 올리고, 저장이 실패하면 되돌린다
  likedIds.add(projectId);
  likeCounts.set(projectId, (likeCounts.get(projectId) || 0) + 1);
  updateLikeButton(button, countNode, projectId);

  try {
    await api('likes', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: { project_id: projectId, client_id: clientId },
    });
    saveLikedIds();
  } catch (err) {
    if (err.status === 409) {
      // 이미 눌렀던 카드: 숫자는 이미 세어져 있으므로 하나 빼고 눌린 상태로 둔다
      likeCounts.set(projectId, Math.max(0, likeCounts.get(projectId) - 1));
      saveLikedIds();
    } else {
      likedIds.delete(projectId);
      likeCounts.set(projectId, Math.max(0, likeCounts.get(projectId) - 1));
      alert('좋아요를 저장하지 못했어요. 잠시 후 다시 눌러 주세요.');
    }
    updateLikeButton(button, countNode, projectId);
  } finally {
    delete button.dataset.busy;
  }
}

// ===== 방명록 =====
function renderGuestbook() {
  const list = $('gb-list');
  if (guestbookItems.length === 0) {
    list.replaceChildren(el('li', 'empty', '아직 남겨진 글이 없어요. 첫 글을 남겨 주세요!'));
    return;
  }
  list.replaceChildren(...guestbookItems.map(makeGuestItem));
}

function makeGuestItem(item) {
  const li = el('li', 'guest-item');
  const head = el('div', 'guest-head');
  head.append(el('span', 'guest-nick', item.nickname), el('span', 'guest-date', formatDate(item.created_at)));
  li.append(head, el('p', 'guest-msg', item.message));
  return li;
}

function showFormError(message) {
  const box = $('gb-error');
  box.textContent = message;
  box.hidden = !message;
}

async function onGuestSubmit() {
  const nickInput = $('gb-nickname');
  const msgInput = $('gb-message');
  const button = $('gb-submit');
  const nickname = nickInput.value.trim();
  const message = msgInput.value.trim();

  if (!nickname) return showFormError('별명을 적어 주세요.');
  if (nickname.length > 20) return showFormError('별명은 20자까지 쓸 수 있어요.');
  if (!message) return showFormError('한마디를 적어 주세요.');
  if (message.length > 200) return showFormError('한마디는 200자까지 쓸 수 있어요.');
  showFormError('');

  button.disabled = true;
  try {
    const rows = await api('resume_guestbook', {
      method: 'POST',
      headers: { Prefer: 'return=representation' },
      body: { nickname, message },
    });
    const saved = Array.isArray(rows) && rows[0]
      ? rows[0]
      : { nickname, message, created_at: new Date().toISOString() };
    guestbookItems.unshift(saved);
    renderGuestbook();
    msgInput.value = '';
  } catch {
    showFormError('글을 남기지 못했어요. 잠시 후 다시 시도해 주세요.');
  } finally {
    button.disabled = false;
  }
}

function setupGuestForm() {
  $('gb-submit').addEventListener('click', onGuestSubmit);
  // 입력 칸에서 Enter 를 눌러도 남기기 (한글 입력 중에는 무시)
  for (const id of ['gb-nickname', 'gb-message']) {
    $(id).addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault();
        onGuestSubmit();
      }
    });
  }
}

// ===== 처음 열 때 모두 읽기 =====
async function loadProfile() {
  const rows = await api('profile?select=*&id=eq.1');
  if (rows && rows[0]) renderProfile(rows[0]);
}

async function loadProjectsAndLikes() {
  const [projectRows, likeRows] = await Promise.all([
    api('projects?select=*&order=sort_order.asc,id.asc'),
    fetchAll('likes?select=project_id,client_id&order=id.asc'),
  ]);
  projects = projectRows || [];

  likedIds = loadLikedIds();
  likeCounts.clear();
  for (const row of likeRows) {
    likeCounts.set(row.project_id, (likeCounts.get(row.project_id) || 0) + 1);
    if (row.client_id === clientId) likedIds.add(row.project_id);
  }
  renderCards();
}

async function loadGuestbook() {
  guestbookItems = await fetchAll('resume_guestbook?select=*&order=created_at.desc,id.desc');
  renderGuestbook();
}

async function init() {
  setupGuestForm();
  const results = await Promise.allSettled([loadProfile(), loadProjectsAndLikes(), loadGuestbook()]);
  if (results.some((r) => r.status === 'rejected')) {
    showStatus('일부 내용을 불러오지 못했어요. 잠시 후 새로고침해 주세요.');
    results.forEach((r) => r.status === 'rejected' && console.error(r.reason));
  }
}

init();
