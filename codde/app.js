const scene = document.querySelector('#scene');
const toast = document.querySelector('#toast');
const authOverlay = document.querySelector('#authOverlay');
const avatarButton = document.querySelector('#avatarButton');
const projectsOverlay = document.querySelector('#projectsOverlay');
let signedInUser = null;
let authMode = 'login';

const translations = {
  en: { title: 'Design a room that feels like you.', copy: 'Shape the space, place every piece, and make it yours.', language: 'Language', enter: 'Enter the studio', eyebrow: 'ROOM DESIGN STUDIO', footer: 'Your room. Your point of view.' },
  fr: { title: 'Imaginez une pièce qui vous ressemble.', copy: 'Composez l’espace, placez chaque élément et créez votre univers.', language: 'Langue', enter: 'Entrer dans l’atelier', eyebrow: 'STUDIO DE DESIGN D’INTÉRIEUR', footer: 'Votre pièce. Votre regard.' },
  ar: { title: 'صمّم غرفة تعبّر عنك.', copy: 'شكّل المساحة، ضع كل قطعة، واجعلها مساحتك.', language: 'اللغة', enter: 'دخول الاستوديو', eyebrow: 'استوديو تصميم الغرف', footer: 'غرفتك. رؤيتك.' },
  cs: { title: 'Navrhněte pokoj podle sebe.', copy: 'Vytvořte prostor, umístěte každý kus a přizpůsobte si ho.', language: 'Jazyk', enter: 'Vstoupit do studia', eyebrow: 'STUDIO NÁVRHU INTERIÉRU', footer: 'Váš pokoj. Váš pohled.' },
  zh: { title: '设计一个属于你的房间。', copy: '规划空间，摆放每件家具，打造专属于你的风格。', language: '语言', enter: '进入工作室', eyebrow: '房间设计工作室', footer: '你的房间，你的视角。' },
  es: { title: 'Diseña una habitación que hable de ti.', copy: 'Organiza el espacio, coloca cada pieza y hazlo tuyo.', language: 'Idioma', enter: 'Entrar al estudio', eyebrow: 'ESTUDIO DE DISEÑO DE HABITACIONES', footer: 'Tu habitación. Tu perspectiva.' }
};

function applyLanguage(language) {
  const selected = translations[language] || translations.en;
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.querySelector('#welcomeTitle').textContent = selected.title;
  document.querySelector('#welcomeCopy').textContent = selected.copy;
  document.querySelector('#languageLabel').textContent = selected.language;
  document.querySelector('#enterLabel').textContent = selected.enter;
  document.querySelector('#welcomeEyebrow').textContent = selected.eyebrow;
  document.querySelector('#welcomeFooter').textContent = selected.footer;
  document.querySelector('#languageSelect').value = language;
  localStorage.setItem('atelier-language', language);
}

const savedLanguage = localStorage.getItem('atelier-language') || 'en';
applyLanguage(savedLanguage);
document.querySelector('#languageSelect').addEventListener('change', event => applyLanguage(event.target.value));
document.querySelector('#enterStudio').addEventListener('click', () => {
  document.querySelector('#welcomeScreen').classList.add('welcome-hidden');
  document.querySelector('#welcomeScreen').setAttribute('aria-hidden', 'true');
});
let zoom = 100;
let draggedItem = null;
let dragOffset = { x: 0, y: 0 };
let orbit = { x: 13, y: -18 };
let orbitStart = null;
let selectedFurniture = null;
let furnitureSequence = 7;
let real3DView = null;

function showToast(message) {
  toast.textContent = message;
  toast.classList.add('visible');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('visible'), 2200);
}

function initialsFromEmail(email) {
  const name = email.split('@')[0].replace(/[._-]+/g, ' ').trim();
  return name.split(' ').map(part => part[0]).join('').slice(0, 2).toUpperCase() || 'AM';
}

async function api(path, options = {}) {
  const response = await fetch(path, { headers: { 'Content-Type': 'application/json', ...(options.headers || {}) }, ...options });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || 'Something went wrong');
  return payload;
}

function openAuth() {
  authOverlay.hidden = false;
  document.querySelector('#emailInput').focus();
}

function closeAuth() {
  authOverlay.hidden = true;
  document.querySelector('#authError').textContent = '';
}

function renderAuthState() {
  const initials = signedInUser ? initialsFromEmail(signedInUser.email) : 'AM';
  avatarButton.textContent = initials;
  avatarButton.setAttribute('aria-label', signedInUser ? `Sign out ${signedInUser.email}` : 'Sign in');
}

avatarButton.addEventListener('click', () => {
  if (signedInUser) {
    api('/api/auth/logout', { method: 'POST' }).catch(() => {}).finally(() => {
      signedInUser = null;
      renderAuthState();
      showToast('Signed out of Atelier');
    });
    return;
  }
  openAuth();
});
document.querySelector('#authClose').addEventListener('click', closeAuth);
authOverlay.addEventListener('click', event => { if (event.target === authOverlay) closeAuth(); });
document.addEventListener('keydown', event => {
  if (event.key === 'Escape') {
    if (!authOverlay.hidden) closeAuth();
    if (!projectsOverlay.hidden) closeProjects();
  }
});
function setAuthMode(mode) {
  authMode = mode;
  document.querySelector('#authTitle').textContent = mode === 'login' ? 'Sign in to your studio' : 'Create your studio account';
  document.querySelector('#authSubmit').childNodes[0].textContent = mode === 'login' ? 'Sign in ' : 'Create account ';
  document.querySelector('#authModeToggle').textContent = mode === 'login' ? 'Need an account? Create one' : 'Already have an account? Sign in';
  document.querySelector('#authError').textContent = '';
}
document.querySelector('#authModeToggle').addEventListener('click', () => setAuthMode(authMode === 'login' ? 'register' : 'login'));
document.querySelector('#signInForm').addEventListener('submit', async event => {
  event.preventDefault();
  const emailInput = document.querySelector('#emailInput');
  const passwordInput = document.querySelector('#passwordInput');
  const error = document.querySelector('#authError');
  if (!emailInput.validity.valid) { error.textContent = 'Enter a valid email address.'; return; }
  if (passwordInput.value.length < 6) { error.textContent = 'Your password needs at least 6 characters.'; return; }
  const submit = document.querySelector('#authSubmit');
  submit.disabled = true;
  try {
    const result = await api(`/api/auth/${authMode}`, { method: 'POST', body: JSON.stringify({ email: emailInput.value.trim(), password: passwordInput.value }) });
    signedInUser = result.user;
    renderAuthState();
    closeAuth();
    showToast(authMode === 'login' ? 'Signed in to your studio' : 'Account created');
  } catch (requestError) {
    error.textContent = requestError.message;
  } finally {
    submit.disabled = false;
  }
});

async function loadSession() {
  try {
    const result = await api('/api/session');
    signedInUser = result.user;
    renderAuthState();
  } catch { signedInUser = null; }
  renderAuthState();
}
loadSession();

function setMode(mode) {
  document.querySelectorAll('.mode-tab').forEach(tab => tab.classList.toggle('active', tab.dataset.mode === mode));
  document.querySelector('#furniturePanel').hidden = mode !== 'furniture';
  document.querySelector('#finishPanel').hidden = mode !== 'finish';
  document.querySelector('#detailsPanel').hidden = mode !== 'details';
}

document.querySelectorAll('.mode-tab').forEach(tab => tab.addEventListener('click', () => setMode(tab.dataset.mode)));

document.querySelectorAll('.swatch').forEach(swatch => swatch.addEventListener('click', () => {
  document.querySelectorAll('.swatch').forEach(item => item.classList.remove('active'));
  swatch.classList.add('active');
  document.querySelector('.back-wall').style.background = swatch.dataset.color;
  showToast('Wall color updated');
}));

document.querySelectorAll('.floor-option').forEach(option => option.addEventListener('click', () => {
  document.querySelectorAll('.floor-option').forEach(item => item.classList.remove('active'));
  option.classList.add('active');
  const floor = document.querySelector('.floor');
  floor.className = `floor ${option.dataset.floor}`;
  if (option.dataset.floor === 'herringbone') floor.style.backgroundImage = 'repeating-linear-gradient(45deg, #af8861 0 8px, #d0a77a 9px 15px)';
  if (option.dataset.floor === 'terrazzo') floor.style.backgroundImage = 'radial-gradient(#a69f93 1px, transparent 2px), radial-gradient(#e9e2d7 2px, transparent 3px)';
  if (option.dataset.floor === 'oak') floor.style.backgroundImage = 'repeating-linear-gradient(90deg, transparent 0 7.5%, rgba(117,75,44,.16) 7.65% 7.8%), repeating-linear-gradient(0deg, transparent 0 24px, rgba(104,70,45,.12) 25px 26px)';
  showToast('Floor finish updated');
}));

function selectFurniture(item) {
  scene.querySelectorAll('.furniture-item.selected').forEach(piece => piece.classList.remove('selected'));
  selectedFurniture = item;
  if (item) item.classList.add('selected');
  document.querySelector('#deleteSelected').disabled = !item;
}

function addFurniture(pieceType, label) {
  const template = scene.querySelector(`[data-id="${pieceType}"]`);
  if (!template) return;
  const item = template.cloneNode(true);
  item.dataset.instance = `piece-${furnitureSequence++}`;
  item.style.left = `${28 + Math.random() * 45}%`;
  item.style.top = `${48 + Math.random() * 22}%`;
  item.classList.remove('selected');
  scene.appendChild(item);
  bindFurnitureItem(item);
  selectFurniture(item);
  item.animate([{ opacity: 0, transform: 'translate(-50%, -50%) scale(.7)' }, { opacity: 1, transform: 'translate(-50%, -50%) scale(1)' }], { duration: 240, easing: 'ease-out' });
  showToast(`${label} added`);
}

document.querySelectorAll('.furniture-card').forEach(card => card.addEventListener('click', () => addFurniture(card.dataset.piece, card.querySelector('span:last-of-type').textContent)));

function getDesignSnapshot() {
  return {
    html: scene.innerHTML,
    length: document.querySelector('#widthRange').value,
    width: document.querySelector('#depthRange').value,
    height: document.querySelector('#heightRange').value,
    wallColor: document.querySelector('.back-wall').style.background,
    floorClass: document.querySelector('.floor').className,
    floorPattern: document.querySelector('.floor').style.backgroundImage,
    view: scene.classList.contains('plan-view') ? 'plan' : '3d',
    orbit
  };
}

function restoreDesign(design) {
  if (!design?.html) return;
  selectedFurniture = null;
  document.querySelector('#deleteSelected').disabled = true;
  scene.innerHTML = design.html;
  scene.querySelectorAll('.furniture-item.selected').forEach(item => item.classList.remove('selected'));
  bindFurnitureInteractions();
  const dimensions = [['width', 'widthRange', 'widthNumber'], ['width', 'depthRange', 'depthNumber'], ['height', 'heightRange', 'heightNumber']];
  [
    ['length', 'widthRange', 'widthNumber'],
    ['width', 'depthRange', 'depthNumber'],
    ['height', 'heightRange', 'heightNumber']
  ].forEach(([key, rangeId, numberId]) => {
    if (design[key] !== undefined) {
      document.querySelector(`#${rangeId}`).value = design[key];
      document.querySelector(`#${numberId}`).value = design[key];
    }
  });
  document.querySelector('.back-wall').style.background = design.wallColor || '';
  const floor = document.querySelector('.floor');
  floor.className = design.floorClass || 'floor oak';
  floor.style.backgroundImage = design.floorPattern || '';
  scene.classList.toggle('plan-view', design.view === 'plan');
  if (design.orbit) {
    orbit = design.orbit;
    scene.style.setProperty('--orbit-x', `${orbit.x}deg`);
    scene.style.setProperty('--orbit-y', `${orbit.y}deg`);
  }
  updateRoomSize();
  updatePlacementStatus();
}

function closeProjects() { projectsOverlay.hidden = true; }

async function openProjects() {
  if (!signedInUser) { openAuth(); return; }
  const list = document.querySelector('#projectList');
  projectsOverlay.hidden = false;
  list.innerHTML = '<p class="project-empty">Loading your projects...</p>';
  try {
    const result = await api('/api/projects');
    if (!result.projects.length) {
      list.innerHTML = '<p class="project-empty">No saved rooms yet. Save your first design to see it here.</p>';
      return;
    }
    list.innerHTML = result.projects.map(project => `<div class="project-row"><button class="project-open" data-project-id="${project.id}"><strong>${project.name.replace(/[<>]/g, '')}</strong><small>Updated ${new Date(`${project.updated_at}Z`).toLocaleDateString()}</small></button><button class="project-delete" data-project-id="${project.id}" aria-label="Delete ${project.name}">×</button></div>`).join('');
    list.querySelectorAll('.project-open').forEach(button => button.addEventListener('click', () => loadProject(button.dataset.projectId)));
    list.querySelectorAll('.project-delete').forEach(button => button.addEventListener('click', () => deleteProject(button.dataset.projectId)));
  } catch (requestError) {
    list.innerHTML = `<p class="project-empty">${requestError.message}</p>`;
  }
}

async function loadProject(projectId) {
  try {
    const result = await api(`/api/projects/${projectId}`);
    restoreDesign(result.project.design);
    document.querySelector('#activeProjectName').textContent = result.project.name;
    closeProjects();
    showToast(`Loaded ${result.project.name}`);
  } catch (requestError) { showToast(requestError.message); }
}

async function deleteProject(projectId) {
  try { await api(`/api/projects/${projectId}`, { method: 'DELETE' }); openProjects(); showToast('Project deleted'); } catch (requestError) { showToast(requestError.message); }
}

document.querySelector('#projectsButton').addEventListener('click', openProjects);
document.querySelector('#projectsClose').addEventListener('click', closeProjects);
projectsOverlay.addEventListener('click', event => { if (event.target === projectsOverlay) closeProjects(); });

document.querySelector('#gridToggle').addEventListener('change', event => scene.classList.toggle('no-grid', !event.target.checked));
document.querySelector('#lightToggle').addEventListener('change', event => scene.classList.toggle('no-light', !event.target.checked));

document.querySelector('#deleteSelected').addEventListener('click', () => {
  if (!selectedFurniture) return;
  const label = selectedFurniture.dataset.id;
  selectedFurniture.remove();
  selectedFurniture = null;
  document.querySelector('#deleteSelected').disabled = true;
  showToast(`${label.charAt(0).toUpperCase() + label.slice(1)} removed`);
});

function updateRoomSize() {
  const width = document.querySelector('#widthRange').value;
  const depth = document.querySelector('#depthRange').value;
  const height = document.querySelector('#heightRange').value;
  document.querySelector('#widthValue').textContent = `${width} m`;
  document.querySelector('#depthValue').textContent = `${depth} m`;
  document.querySelector('#heightValue').textContent = `${height} m`;
  document.querySelector('.length-label').textContent = `${width} m length`;
  document.querySelector('.width-label').textContent = `${depth} m width`;
  document.querySelector('.height-label').textContent = `${height} m height`;
  scene.style.width = `${Math.min(920, 620 + (width - 4) * 85)}px`;
  scene.style.height = `${Math.min(620, 470 + (depth - 3.5) * 60)}px`;
  scene.style.setProperty('--floor-line', `${60 + (height - 2.4) * 10}%`);
}
function syncDimension(sourceId, numberId) {
  const source = document.querySelector(sourceId);
  const number = document.querySelector(numberId);
  source.addEventListener('input', () => { number.value = source.value; updateRoomSize(); });
  number.addEventListener('input', () => { source.value = number.value; updateRoomSize(); });
}
syncDimension('#widthRange', '#widthNumber');
syncDimension('#depthRange', '#depthNumber');
syncDimension('#heightRange', '#heightNumber');
updateRoomSize();

function setZoom(nextZoom) {
  zoom = Math.max(75, Math.min(125, nextZoom));
  document.documentElement.style.setProperty('--scene-scale', zoom / 100);
  document.querySelector('#zoomValue').textContent = `${zoom}%`;
  real3DView?.setZoom(zoom);
}
document.querySelector('#zoomIn').addEventListener('click', () => setZoom(zoom + 10));
document.querySelector('#zoomOut').addEventListener('click', () => setZoom(zoom - 10));
document.querySelector('#sceneWrap').addEventListener('wheel', event => {
  if (!event.metaKey && !event.ctrlKey) return;
  event.preventDefault();
  setZoom(zoom + (event.deltaY < 0 ? 10 : -10));
}, { passive: false });

scene.addEventListener('pointerdown', event => {
  if (event.target.closest('.furniture-item')) return;
  selectFurniture(null);
  orbitStart = { x: event.clientX, y: event.clientY, rotateX: orbit.x, rotateY: orbit.y };
  scene.setPointerCapture(event.pointerId);
  scene.classList.add('orbiting');
});
scene.addEventListener('pointermove', event => {
  if (!orbitStart) return;
  orbit.y = Math.max(-28, Math.min(28, orbitStart.rotateY + (event.clientX - orbitStart.x) * 0.12));
  orbit.x = Math.max(-2, Math.min(20, orbitStart.rotateX - (event.clientY - orbitStart.y) * 0.1));
  scene.style.setProperty('--orbit-x', `${orbit.x}deg`);
  scene.style.setProperty('--orbit-y', `${orbit.y}deg`);
});
scene.addEventListener('pointerup', () => { orbitStart = null; scene.classList.remove('orbiting'); });
scene.addEventListener('pointercancel', () => { orbitStart = null; scene.classList.remove('orbiting'); });

document.addEventListener('keydown', event => {
  const editingField = ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName);
  if ((event.key === 'Delete' || event.key === 'Backspace') && selectedFurniture && !editingField) {
    event.preventDefault();
    document.querySelector('#deleteSelected').click();
  }
});

document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  document.querySelectorAll('[data-view]').forEach(item => item.classList.remove('active'));
  button.classList.add('active');
  scene.classList.toggle('plan-view', button.dataset.view === 'plan');
  real3DView?.setPlanView(button.dataset.view === 'plan');
}));

function bindFurnitureItem(item) {
  item.addEventListener('pointerdown', event => {
    event.stopPropagation();
    selectFurniture(item);
    draggedItem = item;
    item.setPointerCapture(event.pointerId);
    const bounds = scene.getBoundingClientRect();
    dragOffset = { x: event.clientX - bounds.left - (item.offsetLeft + item.offsetWidth / 2), y: event.clientY - bounds.top - (item.offsetTop + item.offsetHeight / 2) };
    item.style.zIndex = 8;
  });
  item.addEventListener('pointermove', event => {
    if (draggedItem !== item) return;
    const bounds = scene.getBoundingClientRect();
    const x = Math.max(5, Math.min(95, ((event.clientX - bounds.left - dragOffset.x) / bounds.width) * 100));
    const y = Math.max(10, Math.min(92, ((event.clientY - bounds.top - dragOffset.y) / bounds.height) * 100));
    item.style.left = `${x}%`;
    item.style.top = `${y}%`;
  });
  item.addEventListener('pointerup', () => { draggedItem = null; item.style.zIndex = item.classList.contains('rug') ? 2 : 3; });
}

function bindFurnitureInteractions() {
  scene.querySelectorAll('.furniture-item').forEach(bindFurnitureItem);
}
bindFurnitureInteractions();

document.querySelector('#saveButton').addEventListener('click', async () => {
  if (!signedInUser) { openAuth(); showToast('Sign in to save your room'); return; }
  const name = window.prompt('Name this room', document.querySelector('#activeProjectName').textContent) || 'Untitled room';
  try {
    await api('/api/projects', { method: 'POST', body: JSON.stringify({ name, design: getDesignSnapshot() }) });
    document.querySelector('#activeProjectName').textContent = name;
    document.querySelector('#saveStatus').textContent = 'Saved just now';
    showToast('Design saved to your projects');
  } catch (requestError) { showToast(requestError.message); }
});
document.querySelector('#shareButton').addEventListener('click', () => showToast('Share link copied to clipboard'));
document.querySelector('#resetButton').addEventListener('click', () => { window.location.reload(); });
document.querySelector('#fullscreenButton').addEventListener('click', () => document.querySelector('.canvas-area').requestFullscreen?.());

function initializeReal3D() {
  if (!window.THREE || !window.THREE.OrbitControls) return;
  const canvas = document.createElement('canvas');
  canvas.id = 'room3d';
  scene.appendChild(canvas);

  const world = new THREE.Scene();
  world.background = new THREE.Color('#b8aea3');
  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(7.5, 6.4, 9.5);
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  } catch (error) {
    canvas.remove();
    console.warn('3D preview unavailable; keeping the interactive room view.', error);
    return;
  }
  scene.classList.add('real-3d');
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const controls = new THREE.OrbitControls(camera, canvas);
  controls.target.set(0, 1.2, 0);
  controls.enableDamping = true;
  controls.minDistance = 5;
  controls.maxDistance = 15;
  controls.maxPolarAngle = Math.PI / 2.05;
  real3DView = {
    setZoom(value) {
      const distance = 12.5 - ((value - 75) / 50) * 5;
      camera.position.setLength(distance);
      controls.update();
    },
    setPlanView(isPlan) {
      if (isPlan) {
        camera.position.set(0, 14, 0.01);
        controls.target.set(0, 0, 0);
        controls.maxPolarAngle = Math.PI;
      } else {
        camera.position.set(7.5, 6.4, 9.5);
        controls.target.set(0, 1.2, 0);
        controls.maxPolarAngle = Math.PI / 2.05;
      }
      controls.update();
    }
  };
  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const draggableMeshes = [];
  let draggedMesh = null;
  let dragOffset = new THREE.Vector3();

  const addDraggable = mesh => {
    draggableMeshes.push(mesh);
    return mesh;
  };

  world.add(new THREE.HemisphereLight('#f4e9da', '#5d4a3d', 1.35));
  const keyLight = new THREE.DirectionalLight('#f6dfbd', 1.9);
  keyLight.position.set(-4, 8, 5);
  keyLight.castShadow = true;
  world.add(keyLight);

  const roomWidth = 10.8;
  const roomDepth = 9.6;
  const roomHeight = 5.6;
  const floorMaterial = new THREE.MeshStandardMaterial({ color: '#b98e66', roughness: .82 });
  const wallMaterial = new THREE.MeshStandardMaterial({ color: '#e8e0d5', roughness: .95 });
  const floor = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, .18, roomDepth), floorMaterial);
  floor.position.y = -.1;
  floor.receiveShadow = true;
  world.add(floor);
  const backWall = new THREE.Mesh(new THREE.BoxGeometry(roomWidth, roomHeight, .16), wallMaterial);
  backWall.position.set(0, roomHeight / 2, -roomDepth / 2);
  backWall.receiveShadow = true;
  world.add(backWall);
  const sideWall = new THREE.Mesh(new THREE.BoxGeometry(.16, roomHeight, roomDepth), new THREE.MeshStandardMaterial({ color: '#d2c7ba' }));
  sideWall.position.set(-roomWidth / 2, roomHeight / 2, 0);
  sideWall.receiveShadow = true;
  world.add(sideWall);

  const material = color => new THREE.MeshStandardMaterial({ color, roughness: .72 });
  const addBox = (width, height, depth, x, y, z, color, rotation = 0) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(width, height, depth), material(color));
    mesh.position.set(x, y, z);
    mesh.rotation.y = rotation;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    world.add(mesh);
    return mesh;
  };
  const addCylinder = (radius, height, x, y, z, color) => {
    const mesh = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, height, 32), material(color));
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    world.add(mesh);
    return mesh;
  };

  addDraggable(addBox(4.8, 1.25, 1.75, -.4, .72, .8, '#ad8774'));
  addBox(.28, 1.5, 1.9, -2.68, .82, .8, '#92705f');
  addBox(.28, 1.5, 1.9, 1.88, .82, .8, '#92705f');
  addBox(2.05, .16, 1.25, -.4, 1.45, .8, '#d0b19f');
  addDraggable(addBox(1.8, .35, 1.8, 1.4, .86, .2, '#9d6d49', 0.12));
  addBox(.12, .65, .12, .75, .38, -.35, '#71482f');
  addBox(.12, .65, .12, 2.05, .38, .45, '#71482f');
  addDraggable(addBox(1.65, 1.65, 1.55, 3.2, .9, 1.1, '#687866'));
  addDraggable(addBox(1.8, .22, .7, -3.25, 2.25, -4.18, '#aa7b58'));
  addDraggable(addBox(3.15, .12, 2.2, -.2, .08, 1.05, '#c8b9a8', -.06));
  addDraggable(addCylinder(.42, .7, 3.7, .35, 2.5, '#b7785d'));
  addDraggable(addCylinder(.52, .9, 3.7, 1.25, 2.5, '#55745e'));

  const resize = () => {
    const width = scene.clientWidth;
    const height = scene.clientHeight;
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  };
  new ResizeObserver(resize).observe(scene);
  resize();
  const updatePointer = event => {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  };
  canvas.addEventListener('pointerdown', event => {
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(draggableMeshes)[0];
    if (!hit || !raycaster.ray.intersectPlane(dragPlane, dragOffset)) return;
    draggedMesh = hit.object;
    dragOffset.sub(draggedMesh.position);
    controls.enabled = false;
    canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove', event => {
    if (!draggedMesh) return;
    updatePointer(event);
    raycaster.setFromCamera(pointer, camera);
    const point = raycaster.ray.intersectPlane(dragPlane, new THREE.Vector3());
    if (point) draggedMesh.position.copy(point.sub(dragOffset));
  });
  const stopDragging = event => {
    if (!draggedMesh) return;
    draggedMesh = null;
    controls.enabled = true;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  };
  canvas.addEventListener('pointerup', stopDragging);
  canvas.addEventListener('pointercancel', stopDragging);
  const render = () => {
    controls.update();
    renderer.render(world, camera);
    requestAnimationFrame(render);
  };
  render();
}

initializeReal3D();
