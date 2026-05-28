const STORAGE_KEY = "team-splitter-state-v1";
const CLOUD_ENDPOINT = "https://mantledb.sh/v2/team-splitter-micheal-tcy/shared-state";

const state = {
  members: [],
  teams: [],
};

let pointerDrag = null;
let saveTimer = null;
let lastCloudUpdatedAt = "";

const elements = {
  addMemberForm: document.querySelector("#addMemberForm"),
  memberNameInput: document.querySelector("#memberNameInput"),
  memberList: document.querySelector("#memberList"),
  memberCount: document.querySelector("#memberCount"),
  selectedCount: document.querySelector("#selectedCount"),
  teamSizeInput: document.querySelector("#teamSizeInput"),
  teamCountInput: document.querySelector("#teamCountInput"),
  shuffleInput: document.querySelector("#shuffleInput"),
  generateBtn: document.querySelector("#generateBtn"),
  selectAllBtn: document.querySelector("#selectAllBtn"),
  selectNoneBtn: document.querySelector("#selectNoneBtn"),
  resetDemoBtn: document.querySelector("#resetDemoBtn"),
  teamsContainer: document.querySelector("#teamsContainer"),
  summaryText: document.querySelector("#summaryText"),
  hintText: document.querySelector("#hintText"),
  syncStatus: document.querySelector("#syncStatus"),
  emptyStateTemplate: document.querySelector("#emptyStateTemplate"),
};

function createId() {
  return `member-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setSyncStatus(message, type = "pending") {
  elements.syncStatus.textContent = message;
  elements.syncStatus.classList.toggle("is-online", type === "online");
  elements.syncStatus.classList.toggle("is-error", type === "error");
}

function getSnapshot() {
  return {
    members: state.members,
    teams: state.teams,
    updatedAt: new Date().toISOString(),
  };
}

function applySnapshot(snapshot) {
  state.members = Array.isArray(snapshot?.members) ? snapshot.members : [];
  state.teams = Array.isArray(snapshot?.teams) ? snapshot.teams : [];
}

function saveLocalState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(getSnapshot()));
}

function loadLocalState() {
  const saved = localStorage.getItem(STORAGE_KEY);
  if (!saved) return;

  try {
    applySnapshot(JSON.parse(saved));
  } catch {
    localStorage.removeItem(STORAGE_KEY);
  }
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 8000);

  try {
    return await fetch(url, {
      ...options,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timeoutId);
  }
}

async function loadCloudState() {
  setSyncStatus("正在同步云端...");

  try {
    const response = await fetchWithTimeout(CLOUD_ENDPOINT, { cache: "no-store" });

    if (response.status === 404) {
      await persistCloudState();
      return;
    }

    if (!response.ok) {
      throw new Error(`Cloud load failed: ${response.status}`);
    }

    const snapshot = await response.json();
    lastCloudUpdatedAt = snapshot.updatedAt || "";
    applySnapshot(snapshot);
    saveLocalState();
    setSyncStatus("云端已同步", "online");
  } catch (error) {
    console.error(error);
    setSyncStatus("云端连接失败，暂用本地数据", "error");
  }
}

function queueCloudSave() {
  clearTimeout(saveTimer);
  setSyncStatus("正在保存到云端...");
  saveTimer = setTimeout(persistCloudState, 350);
}

async function persistCloudState() {
  const snapshot = getSnapshot();

  try {
    const response = await fetchWithTimeout(CLOUD_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(snapshot),
    });

    if (!response.ok) {
      throw new Error(`Cloud save failed: ${response.status}`);
    }

    lastCloudUpdatedAt = snapshot.updatedAt;
    setSyncStatus("已保存到共享云端", "online");
  } catch (error) {
    console.error(error);
    setSyncStatus("云端保存失败，已保存在本机", "error");
  }
}

async function refreshCloudState() {
  if (pointerDrag) return;

  try {
    const response = await fetchWithTimeout(CLOUD_ENDPOINT, { cache: "no-store" });
    if (!response.ok) return;

    const snapshot = await response.json();
    if (!snapshot.updatedAt || snapshot.updatedAt === lastCloudUpdatedAt) return;

    lastCloudUpdatedAt = snapshot.updatedAt;
    applySnapshot(snapshot);
    saveLocalState();
    render();
    setSyncStatus("已更新共享数据", "online");
  } catch (error) {
    console.error(error);
  }
}

function saveState() {
  saveLocalState();
  queueCloudSave();
}

function getSelectedMembers() {
  return state.members.filter((member) => member.selected);
}

function shuffle(items) {
  const result = [...items];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const randomIndex = Math.floor(Math.random() * (index + 1));
    [result[index], result[randomIndex]] = [result[randomIndex], result[index]];
  }
  return result;
}

function rebalanceSettings() {
  const selectedTotal = getSelectedMembers().length;
  const teamSize = Math.max(1, Number(elements.teamSizeInput.value) || 1);
  const teamCount = Math.max(1, Number(elements.teamCountInput.value) || 1);
  const capacity = teamSize * teamCount;

  if (selectedTotal > capacity) {
    elements.hintText.textContent = `当前选择 ${selectedTotal} 人，容量 ${capacity} 人。超出人员会放入“待安排”队伍，可继续手动调整。`;
  } else {
    elements.hintText.textContent = "提示：自动分队后，可以拖动人员卡片到其他队伍。";
  }
}

function renderMembers() {
  elements.memberList.replaceChildren();

  state.members.forEach((member) => {
    const item = document.createElement("li");
    item.className = "member-item";

    const label = document.createElement("label");
    label.className = "member-check";

    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.checked = member.selected;
    checkbox.addEventListener("change", () => {
      member.selected = checkbox.checked;
      saveState();
      render();
    });

    const name = document.createElement("span");
    name.className = "member-name";
    name.textContent = member.name;

    const deleteButton = document.createElement("button");
    deleteButton.className = "delete-button";
    deleteButton.type = "button";
    deleteButton.textContent = "删除";
    deleteButton.addEventListener("click", () => removeMember(member.id));

    label.append(checkbox, name);
    item.append(label, deleteButton);
    elements.memberList.append(item);
  });

  if (state.members.length === 0) {
    const empty = document.createElement("li");
    empty.className = "empty-state";
    empty.innerHTML = "<h3>名单为空</h3><p>添加人员后，可勾选指定谁参与本次分队。</p>";
    elements.memberList.append(empty);
  }
}

function renderTeams() {
  elements.teamsContainer.replaceChildren();

  if (state.teams.length === 0) {
    elements.teamsContainer.append(elements.emptyStateTemplate.content.cloneNode(true));
    return;
  }

  state.teams.forEach((team, teamIndex) => {
    const card = document.createElement("article");
    card.className = "team-card";
    card.dataset.teamIndex = String(teamIndex);

    const header = document.createElement("div");
    header.className = "team-header";

    const title = document.createElement("h3");
    title.textContent = team.name;

    const count = document.createElement("span");
    count.className = "pill";
    count.textContent = `${team.members.length} 人`;

    const list = document.createElement("ul");
    list.className = "team-members";

    team.members.forEach((member) => {
      const item = document.createElement("li");
      item.className = "team-member";

      const name = document.createElement("span");
      name.textContent = member.name;

      const dragHandle = document.createElement("span");
      dragHandle.className = "drag-handle";
      dragHandle.textContent = "拖动";

      item.addEventListener("pointerdown", (event) => {
        startPointerDrag(event, {
          memberId: member.id,
          fromTeamIndex: teamIndex,
          sourceElement: item,
        });
      });

      item.append(name, dragHandle);
      list.append(item);
    });

    if (team.members.length === 0) {
      const empty = document.createElement("li");
      empty.className = "empty-state";
      empty.innerHTML = "<p>该队暂时没人，可把其他队伍的人员拖到这里。</p>";
      list.append(empty);
    }

    header.append(title, count);
    card.append(header, list);
    elements.teamsContainer.append(card);
  });
}

function clearDropTargets() {
  document.querySelectorAll(".team-card.is-drag-over").forEach((teamCard) => {
    teamCard.classList.remove("is-drag-over");
  });
}

function getTeamIndexAtPoint(clientX, clientY) {
  const target = document.elementFromPoint(clientX, clientY)?.closest(".team-card");
  if (!target) return -1;
  return Number(target.dataset.teamIndex);
}

function updateDragTarget(clientX, clientY) {
  clearDropTargets();
  const teamIndex = getTeamIndexAtPoint(clientX, clientY);
  if (teamIndex < 0) return;

  const target = document.querySelector(`.team-card[data-team-index="${teamIndex}"]`);
  target?.classList.add("is-drag-over");
}

function moveDragGhost(clientX, clientY) {
  if (!pointerDrag) return;

  pointerDrag.ghost.style.left = `${clientX - pointerDrag.offsetX}px`;
  pointerDrag.ghost.style.top = `${clientY - pointerDrag.offsetY}px`;
}

function finishPointerDrag(event) {
  if (!pointerDrag) return;

  const { memberId, fromTeamIndex, sourceElement, ghost } = pointerDrag;
  const toTeamIndex = getTeamIndexAtPoint(event.clientX, event.clientY);

  ghost.remove();
  sourceElement.classList.remove("is-dragging");
  document.body.classList.remove("is-pointer-dragging");
  clearDropTargets();
  pointerDrag = null;

  document.removeEventListener("pointermove", handlePointerMove);
  document.removeEventListener("pointerup", finishPointerDrag);
  document.removeEventListener("pointercancel", cancelPointerDrag);

  if (toTeamIndex >= 0 && toTeamIndex !== fromTeamIndex) {
    moveMember(memberId, fromTeamIndex, toTeamIndex);
  }
}

function cancelPointerDrag() {
  if (!pointerDrag) return;

  pointerDrag.ghost.remove();
  pointerDrag.sourceElement.classList.remove("is-dragging");
  document.body.classList.remove("is-pointer-dragging");
  clearDropTargets();
  pointerDrag = null;

  document.removeEventListener("pointermove", handlePointerMove);
  document.removeEventListener("pointerup", finishPointerDrag);
  document.removeEventListener("pointercancel", cancelPointerDrag);
}

function handlePointerMove(event) {
  if (!pointerDrag) return;

  moveDragGhost(event.clientX, event.clientY);
  updateDragTarget(event.clientX, event.clientY);
}

function startPointerDrag(event, { memberId, fromTeamIndex, sourceElement }) {
  if (event.button !== undefined && event.button !== 0) return;

  event.preventDefault();
  const rect = sourceElement.getBoundingClientRect();
  const ghost = sourceElement.cloneNode(true);
  ghost.classList.add("drag-ghost");
  ghost.style.width = `${rect.width}px`;
  document.body.append(ghost);

  pointerDrag = {
    memberId,
    fromTeamIndex,
    sourceElement,
    ghost,
    offsetX: event.clientX - rect.left,
    offsetY: event.clientY - rect.top,
  };

  sourceElement.classList.add("is-dragging");
  document.body.classList.add("is-pointer-dragging");
  moveDragGhost(event.clientX, event.clientY);
  updateDragTarget(event.clientX, event.clientY);

  document.addEventListener("pointermove", handlePointerMove);
  document.addEventListener("pointerup", finishPointerDrag);
  document.addEventListener("pointercancel", cancelPointerDrag);
}

function renderSummary() {
  const selectedTotal = getSelectedMembers().length;
  const assignedTotal = state.teams.reduce((total, team) => total + team.members.length, 0);
  elements.memberCount.textContent = `${state.members.length} 人`;
  elements.selectedCount.textContent = `已选 ${selectedTotal} 人`;
  elements.summaryText.textContent = state.teams.length > 0 ? `${state.teams.length} 队，共 ${assignedTotal} 人` : "尚未生成";
  rebalanceSettings();
}

function render() {
  renderMembers();
  renderTeams();
  renderSummary();
}

function addMember(name) {
  const trimmedName = name.trim();
  if (!trimmedName) return;

  const isDuplicate = state.members.some((member) => member.name === trimmedName);
  if (isDuplicate) {
    alert("名单中已经有这个人了。");
    return;
  }

  state.members.push({
    id: createId(),
    name: trimmedName,
    selected: true,
  });
  saveState();
  render();
}

function removeMember(memberId) {
  state.members = state.members.filter((member) => member.id !== memberId);
  state.teams = state.teams.map((team) => ({
    ...team,
    members: team.members.filter((member) => member.id !== memberId),
  }));
  saveState();
  render();
}

function setAllSelected(selected) {
  state.members = state.members.map((member) => ({ ...member, selected }));
  saveState();
  render();
}

function generateTeams() {
  const selectedMembers = getSelectedMembers();
  const teamSize = Math.max(1, Number(elements.teamSizeInput.value) || 1);
  const teamCount = Math.max(1, Number(elements.teamCountInput.value) || 1);
  const orderedMembers = elements.shuffleInput.checked ? shuffle(selectedMembers) : selectedMembers;
  const teams = Array.from({ length: teamCount }, (_, index) => ({
    name: `第 ${index + 1} 队`,
    members: [],
  }));

  orderedMembers.forEach((member, index) => {
    const targetIndex = Math.min(Math.floor(index / teamSize), teamCount - 1);
    teams[targetIndex].members.push({ id: member.id, name: member.name });
  });

  const overflowStart = teamSize * teamCount;
  if (orderedMembers.length > overflowStart) {
    teams.push({
      name: "待安排",
      members: orderedMembers.slice(overflowStart).map((member) => ({ id: member.id, name: member.name })),
    });
    teams[teamCount - 1].members = teams[teamCount - 1].members.slice(0, teamSize);
  }

  state.teams = teams;
  saveState();
  render();
}

function moveMember(memberId, fromTeamIndex, toTeamIndex) {
  if (toTeamIndex < 0 || toTeamIndex >= state.teams.length) return;

  const fromTeam = state.teams[fromTeamIndex];
  const toTeam = state.teams[toTeamIndex];
  const memberIndex = fromTeam.members.findIndex((member) => member.id === memberId);
  if (memberIndex === -1) return;

  const [member] = fromTeam.members.splice(memberIndex, 1);
  toTeam.members.push(member);
  saveState();
  render();
}

elements.addMemberForm.addEventListener("submit", (event) => {
  event.preventDefault();
  addMember(elements.memberNameInput.value);
  elements.memberNameInput.value = "";
  elements.memberNameInput.focus();
});

elements.generateBtn.addEventListener("click", generateTeams);
elements.selectAllBtn.addEventListener("click", () => setAllSelected(true));
elements.selectNoneBtn.addEventListener("click", () => setAllSelected(false));
elements.teamSizeInput.addEventListener("input", rebalanceSettings);
elements.teamCountInput.addEventListener("input", rebalanceSettings);

elements.resetDemoBtn.addEventListener("click", () => {
  if (!confirm("确定要清空所有共享人员和分队结果吗？其他打开页面的人也会看到清空后的数据。")) return;
  state.members = [];
  state.teams = [];
  saveState();
  render();
});

async function initialize() {
  loadLocalState();
  render();
  await loadCloudState();
  render();
  setInterval(refreshCloudState, 8000);
}

initialize();
