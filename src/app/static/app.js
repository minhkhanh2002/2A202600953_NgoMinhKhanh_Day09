// App state
let activeTab = 'chat';
let databaseData = { customers: [], orders: [], vouchers: [] };
let activeDbSubTab = 'customers';
let policies = [];
let testSuite = [];
let activeChatTrace = [];

// DOM Elements
const navButtons = document.querySelectorAll('.nav-btn');
const tabPanes = document.querySelectorAll('.tab-pane');
const chatForm = document.getElementById('chat-form');
const chatInput = document.getElementById('chat-input');
const chatMessages = document.getElementById('chat-messages');
const suggestions = document.querySelectorAll('.suggest-btn');
const dbTabButtons = document.querySelectorAll('.db-tab-btn');
const dbSearchInput = document.getElementById('db-search-input');
const policySearch = document.getElementById('policy-search');
const runSuiteBtn = document.getElementById('run-suite-btn');
const progressBar = document.getElementById('test-progress-bar');
const progressFill = progressBar ? progressBar.querySelector('.progress-fill') : null;
const modal = document.getElementById('trace-modal');
const closeModalBtn = document.getElementById('close-modal');

// Init
document.addEventListener('DOMContentLoaded', () => {
  setupNavigation();
  setupChat();
  setupDatabase();
  setupPolicies();
  setupTestRunners();
  
  // Initial data fetches
  fetchDatabase();
  fetchPolicies();
  fetchTests();
  
  // SVG paths layout
  setTimeout(updateConnections, 500);
  window.addEventListener('resize', updateConnections);
});

// Sidebar navigation
function setupNavigation() {
  navButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tab;
      
      navButtons.forEach(b => b.classList.remove('active'));
      tabPanes.forEach(pane => pane.classList.remove('active'));
      
      btn.classList.add('active');
      document.getElementById(`${target}-tab`).classList.add('active');
      
      activeTab = target;
      
      if (activeTab === 'chat') {
        setTimeout(updateConnections, 50);
      }
    });
  });
}

// Draw dynamic connection paths on the graph
function updateConnections() {
  const container = document.querySelector('.graph-svg-container');
  if (!container) return;
  const containerRect = container.getBoundingClientRect();

  const getCenter = (id) => {
    const el = document.getElementById(id);
    if (!el) return { x: 0, y: 0 };
    const r = el.getBoundingClientRect();
    return {
      x: (r.left + r.right) / 2 - containerRect.left,
      y: (r.top + r.bottom) / 2 - containerRect.top
    };
  };

  const drawPath = (pathId, fromId, toId) => {
    const path = document.getElementById(pathId);
    if (!path) return;
    const from = getCenter(fromId);
    const to = getCenter(toId);
    if (from.x === 0 || to.x === 0) return;
    
    if (fromId === 'node-supervisor' && toId === 'node-data') {
      // Curve right
      path.setAttribute('d', `M ${from.x} ${from.y} C ${from.x + 60} ${from.y + 30}, ${to.x} ${to.y - 45}, ${to.x} ${to.y}`);
    } else if (fromId === 'node-supervisor' && toId === 'node-policy') {
      // Curve left
      path.setAttribute('d', `M ${from.x} ${from.y} C ${from.x - 60} ${from.y + 30}, ${to.x} ${to.y - 45}, ${to.x} ${to.y}`);
    } else if (fromId === 'node-policy' && toId === 'node-response') {
      // Curve left bottom
      path.setAttribute('d', `M ${from.x} ${from.y} C ${from.x} ${from.y + 45}, ${to.x - 60} ${to.y - 30}, ${to.x} ${to.y}`);
    } else if (fromId === 'node-data' && toId === 'node-response') {
      // Curve right bottom
      path.setAttribute('d', `M ${from.x} ${from.y} C ${from.x} ${from.y + 45}, ${to.x + 60} ${to.y - 30}, ${to.x} ${to.y}`);
    } else {
      // Straight line
      path.setAttribute('d', `M ${from.x} ${from.y} L ${to.x} ${to.y}`);
    }
  };

  drawPath('path-start-supervisor', 'node-start', 'node-supervisor');
  drawPath('path-supervisor-policy', 'node-supervisor', 'node-policy');
  drawPath('path-supervisor-data', 'node-supervisor', 'node-data');
  drawPath('path-supervisor-response', 'node-supervisor', 'node-response');
  drawPath('path-policy-data', 'node-policy', 'node-data');
  drawPath('path-policy-response', 'node-policy', 'node-response');
  drawPath('path-data-response', 'node-data', 'node-response');
}

// ----------------- CHAT TAB -----------------
function setupChat() {
  chatForm.addEventListener('submit', async (e) => {
    e.preventDefault();
    const question = chatInput.value.trim();
    if (!question) return;
    
    chatInput.value = '';
    await askQuestion(question);
  });

  suggestions.forEach(btn => {
    btn.addEventListener('click', async () => {
      const question = btn.dataset.q;
      await askQuestion(question);
    });
  });

  // Bind clicking on nodes in visual graph
  const nodes = document.querySelectorAll('.agent-node');
  nodes.forEach(node => {
    node.addEventListener('click', () => {
      const nodeName = node.dataset.name;
      inspectActiveNode(nodeName);
    });
  });
}

async function askQuestion(question) {
  // Add user bubble
  appendMessage('user', question);
  
  // Add agent loader
  const loaderId = appendMessage('system', '<i class="fa-solid fa-circle-notch fa-spin"></i> Đang suy nghĩ...', true);
  
  // Reset graph highlights
  resetGraphVisuals();
  setNodeState('node-start', 'completed-node');
  setPathState('path-start-supervisor', 'completed-path');
  setNodeState('node-supervisor', 'active-node');
  
  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ question })
    });
    
    if (!res.ok) throw new Error("API Server error");
    const data = await res.json();
    
    // Remove loader
    document.getElementById(loaderId).remove();
    
    // Add answer bubble
    appendMessage('system', data.final_answer);
    
    // Save active trace and update visual flow
    activeChatTrace = data.trace || [];
    animateVisualFlow(data);
    
  } catch (err) {
    document.getElementById(loaderId).remove();
    appendMessage('system', `<span style="color: var(--danger-color);"><i class="fa-solid fa-circle-exclamation"></i> Lỗi: ${err.message}. Vui lòng thử lại.</span>`);
    setNodeState('node-supervisor', 'failed-node');
  }
}

function appendMessage(sender, text, isHtml = false) {
  const msgId = 'msg-' + Date.now();
  const div = document.createElement('div');
  div.className = `message ${sender}`;
  div.id = msgId;
  
  const icon = sender === 'user' ? 'fa-user' : 'fa-robot';
  
  div.innerHTML = `
    <div class="avatar"><i class="fa-solid ${icon}"></i></div>
    <div class="content">${isHtml ? text : escapeHTML(text)}</div>
  `;
  
  chatMessages.appendChild(div);
  chatMessages.scrollTop = chatMessages.scrollHeight;
  return msgId;
}

function resetGraphVisuals() {
  const nodes = document.querySelectorAll('.node');
  nodes.forEach(n => {
    n.className = 'node';
    if (n.id === 'node-start') n.classList.add('start-node');
    else n.classList.add('agent-node');
  });
  
  const paths = document.querySelectorAll('.graph-connections path');
  paths.forEach(p => p.className.baseVal = '');
  
  document.getElementById('inspector-content').innerHTML = `
    <div class="empty-state">Chưa có thông tin thực thi. Hãy gửi tin nhắn hoặc chọn một câu hỏi mẫu để bắt đầu.</div>
  `;
}

function setNodeState(nodeId, stateClass) {
  const node = document.getElementById(nodeId);
  if (node) {
    node.classList.remove('active-node', 'completed-node', 'failed-node');
    node.classList.add(stateClass);
  }
}

function setPathState(pathId, stateClass) {
  const path = document.getElementById(pathId);
  if (path) {
    path.className.baseVal = stateClass;
  }
}

function animateVisualFlow(data) {
  resetGraphVisuals();
  
  setNodeState('node-start', 'completed-node');
  setPathState('path-start-supervisor', 'completed-path');
  
  const route = data.route || {};
  const needsPolicy = route.needs_policy;
  const needsData = route.needs_data;
  const status = route.status;
  
  // 1. Supervisor
  setNodeState('node-supervisor', 'completed-node');
  
  // Routing logic connections
  if (status === 'clarification_needed') {
    setPathState('path-supervisor-response', 'completed-path');
    setNodeState('node-response', 'completed-node');
    inspectActiveNode('worker_3_response');
    return;
  }
  
  if (needsPolicy) {
    setPathState('path-supervisor-policy', 'completed-path');
    setNodeState('node-policy', 'completed-node');
  }
  
  if (needsData) {
    if (needsPolicy) {
      setPathState('path-policy-data', 'completed-path');
    } else {
      setPathState('path-supervisor-data', 'completed-path');
    }
    setNodeState('node-data', 'completed-node');
  }
  
  if (needsData) {
    setPathState('path-data-response', 'completed-path');
  } else if (needsPolicy) {
    setPathState('path-policy-response', 'completed-path');
  } else {
    setPathState('path-supervisor-response', 'completed-path');
  }
  
  setNodeState('node-response', 'completed-node');
  
  // Default inspector to response results
  inspectActiveNode('worker_3_response');
}

function inspectActiveNode(nodeName) {
  const inspectorBody = document.getElementById('inspector-content');
  if (!activeChatTrace || activeChatTrace.length === 0) {
    inspectorBody.innerHTML = `<div class="empty-state">Không có dữ liệu vết cho hoạt động hiện tại.</div>`;
    return;
  }
  
  const step = activeChatTrace.find(t => t.node === nodeName);
  if (!step) {
    inspectorBody.innerHTML = `<div class="empty-state">Nút <strong>${nodeName}</strong> không được thực thi trong lượt này.</div>`;
    return;
  }
  
  let contentHtml = `<div class="trace-details">`;
  
  if (nodeName === 'supervisor') {
    contentHtml += `
      <div class="trace-log-item">
        <label>Định tuyến quyết định (Supervisor JSON):</label>
        <pre>${JSON.stringify(step.output, null, 2)}</pre>
      </div>
    `;
  } else if (nodeName === 'worker_1_policy') {
    contentHtml += `
      <div class="trace-log-item">
        <label>Trích dẫn chính sách thu hồi:</label>
        <pre>${JSON.stringify(step.search_results || [], null, 2)}</pre>
      </div>
      <div class="trace-log-item">
        <label>Tóm tắt thông tin (Output):</label>
        <pre>${JSON.stringify(step.output, null, 2)}</pre>
      </div>
    `;
  } else if (nodeName === 'worker_2_data') {
    contentHtml += `
      <div class="trace-log-item">
        <label>Lịch sử gọi Tool (Database Lookup):</label>
        <pre>${JSON.stringify(step.tool_calls || [], null, 2)}</pre>
      </div>
      <div class="trace-log-item">
        <label>Tổng hợp dữ liệu trích xuất (Output):</label>
        <pre>${JSON.stringify(step.output, null, 2)}</pre>
      </div>
    `;
  } else if (nodeName === 'worker_3_response') {
    contentHtml += `
      <div class="trace-log-item">
        <label>Câu trả lời hoàn thiện cuối cùng:</label>
        <pre>${step.output}</pre>
      </div>
    `;
  }
  
  contentHtml += `</div>`;
  inspectorBody.innerHTML = contentHtml;
  
  // Update inspector header label
  document.querySelector('.inspector-header h3').innerHTML = `<i class="fa-solid fa-square-poll-horizontal"></i> Chi tiết nút: ${nodeName}`;
}


// ----------------- DATABASE TAB -----------------
function setupDatabase() {
  dbTabButtons.forEach(btn => {
    btn.addEventListener('click', () => {
      dbTabButtons.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      activeDbSubTab = btn.dataset.db;
      renderDatabaseTable();
    });
  });

  dbSearchInput.addEventListener('input', renderDatabaseTable);
}

async function fetchDatabase() {
  try {
    const res = await fetch('/api/database');
    if (res.ok) {
      databaseData = await res.json();
      renderDatabaseTable();
    }
  } catch (err) {
    console.error("Lỗi fetch database:", err);
  }
}

function renderDatabaseTable() {
  const headersRow = document.getElementById('table-headers');
  const body = document.getElementById('table-body');
  const searchQuery = dbSearchInput.value.toLowerCase().trim();
  
  headersRow.innerHTML = '';
  body.innerHTML = '';
  
  const dataList = databaseData[activeDbSubTab] || [];
  if (dataList.length === 0) {
    body.innerHTML = `<tr><td colspan="10" style="text-align:center;">Không có dữ liệu</td></tr>`;
    return;
  }
  
  // Filter items
  const filteredList = dataList.filter(item => {
    const valString = JSON.stringify(item).toLowerCase();
    return valString.includes(searchQuery);
  });
  
  if (filteredList.length === 0) {
    body.innerHTML = `<tr><td colspan="10" style="text-align:center;">Không tìm thấy bản ghi phù hợp</td></tr>`;
    return;
  }

  // Get keys for headers dynamically
  const keys = Object.keys(dataList[0]).filter(k => typeof dataList[0][k] !== 'object' || dataList[0][k] === null);
  
  // Set headers
  keys.forEach(k => {
    const th = document.createElement('th');
    th.textContent = k;
    headersRow.appendChild(th);
  });
  
  // Render rows
  filteredList.forEach(item => {
    const tr = document.createElement('tr');
    keys.forEach(k => {
      const td = document.createElement('td');
      const val = item[k];
      
      if (k === 'status' || k === 'account_status') {
        if (val === 'active' || val === 'delivered' || val === 'completed' || val === 'ok') {
          td.innerHTML = `<span class="badge badge-success">${val}</span>`;
        } else if (val === 'in_transit' || val === 'processing' || val === 'packed') {
          td.innerHTML = `<span class="badge badge-warning">${val}</span>`;
        } else {
          td.innerHTML = `<span class="badge badge-danger">${val}</span>`;
        }
      } else if (k === 'remaining_voucher_quota_this_month' || k === 'max_voucher_per_month' || k === 'vouchers_used_this_month') {
        td.innerHTML = `<strong style="font-family: var(--font-code); color: #818cf8;">${val}</strong>`;
      } else {
        td.textContent = val !== null ? val : 'null';
      }
      
      tr.appendChild(td);
    });
    body.appendChild(tr);
  });
}


// ----------------- RAG POLICIES TAB -----------------
function setupPolicies() {
  policySearch.addEventListener('input', renderPoliciesGrid);
}

async function fetchPolicies() {
  const container = document.getElementById('policies-grid');
  try {
    const res = await fetch('/api/policies');
    if (res.ok) {
      const data = await res.json();
      policies = data.chunks || [];
      renderPoliciesGrid();
    }
  } catch (err) {
    container.innerHTML = `<div class="loader-placeholder" style="color:var(--danger-color);"><i class="fa-solid fa-circle-exclamation"></i> Không thể tải chính sách.</div>`;
  }
}

function renderPoliciesGrid() {
  const container = document.getElementById('policies-grid');
  const query = policySearch.value.toLowerCase().trim();
  container.innerHTML = '';
  
  const filtered = policies.filter(p => {
    return p.content.toLowerCase().includes(query) || 
           (p.metadata.section_h2 || '').toLowerCase().includes(query) ||
           (p.metadata.section_h3 || '').toLowerCase().includes(query);
  });
  
  if (filtered.length === 0) {
    container.innerHTML = `<div class="loader-placeholder">Không tìm thấy phân đoạn chính sách phù hợp.</div>`;
    return;
  }
  
  filtered.forEach(p => {
    const card = document.createElement('div');
    card.className = 'policy-card';
    
    const h3Html = p.metadata.section_h3 ? `<div class="title-h3">${escapeHTML(p.metadata.section_h3)}</div>` : '';
    
    card.innerHTML = `
      <div class="citation"><i class="fa-solid fa-link"></i> ${escapeHTML(p.metadata.citation)}</div>
      <div class="title-h2">${escapeHTML(p.metadata.section_h2 || 'Chính sách chung')}</div>
      ${h3Html}
      <div class="body">${escapeHTML(p.content).replace(/\n/g, '<br>')}</div>
    `;
    container.appendChild(card);
  });
}


// ----------------- BATCH TESTS DASHBOARD -----------------
function setupTestRunners() {
  runSuiteBtn.addEventListener('click', runTestSuite);
  closeModalBtn.addEventListener('click', () => {
    modal.style.display = 'none';
  });
  window.addEventListener('click', (e) => {
    if (e.target === modal) {
      modal.style.display = 'none';
    }
  });
}

async function fetchTests() {
  try {
    const res = await fetch('/api/tests');
    if (res.ok) {
      const data = await res.json();
      testSuite = data.tests || [];
      const summary = data.summary;
      
      renderMetrics(summary);
      renderTestsTable(testSuite, summary);
    }
  } catch (err) {
    console.error("Lỗi fetch test suite:", err);
  }
}

function renderMetrics(summary) {
  const mTotal = document.getElementById('metric-total');
  const mPassed = document.getElementById('metric-passed');
  const mFailed = document.getElementById('metric-failed');
  const mRate = document.getElementById('metric-rate');
  
  if (!summary || !summary.metrics) {
    mTotal.textContent = '22';
    mPassed.textContent = '-';
    mFailed.textContent = '-';
    mRate.textContent = '-%';
    return;
  }
  
  const m = summary.metrics;
  mTotal.textContent = m.total;
  mPassed.textContent = m.passed;
  mFailed.textContent = m.failed;
  mRate.textContent = `${(m.pass_rate * 100).toFixed(1)}%`;
}

function renderTestsTable(tests, summary) {
  const tbody = document.getElementById('tests-table-body');
  tbody.innerHTML = '';
  
  const resultsMap = {};
  if (summary && summary.results) {
    summary.results.forEach(r => {
      resultsMap[r.id] = r;
    });
  }
  
  tests.forEach(t => {
    const tr = document.createElement('tr');
    const res = resultsMap[t.id];
    
    // Status badges or placeholders
    let actualRouteBadge = '<span class="text-muted">-</span>';
    let actualStatusBadge = '<span class="text-muted">-</span>';
    let resultBadge = '<span class="badge" style="background:rgba(255,255,255,0.05); color:var(--text-muted);">UNRUN</span>';
    let inspectBtnHtml = `<button class="inspect-btn" disabled><i class="fa-solid fa-magnifying-glass"></i></button>`;
    
    if (res) {
      actualRouteBadge = res.actual_route.length > 0 ? res.actual_route.map(r => `<span class="badge badge-info">${r}</span>`).join(' ') : '[]';
      
      const sColor = res.actual_status === 'ok' ? 'success' : (res.actual_status === 'not_found' ? 'danger' : 'warning');
      actualStatusBadge = `<span class="badge badge-${sColor}">${res.actual_status}</span>`;
      
      if (res.success) {
        resultBadge = '<span class="badge badge-success"><i class="fa-solid fa-check"></i> PASSED</span>';
      } else {
        resultBadge = '<span class="badge badge-danger"><i class="fa-solid fa-xmark"></i> FAILED</span>';
      }
      inspectBtnHtml = `<button class="inspect-btn" onclick="openTraceModal('${t.id}')"><i class="fa-solid fa-magnifying-glass"></i></button>`;
    }
    
    const expRoute = t.expected_route.length > 0 ? t.expected_route.map(r => `<span class="badge badge-info">${r}</span>`).join(' ') : '[]';
    const expStatusColor = t.expected_status === 'ok' ? 'success' : (t.expected_status === 'not_found' ? 'danger' : 'warning');
    const expStatus = `<span class="badge badge-${expStatusColor}">${t.expected_status}</span>`;
    
    tr.innerHTML = `
      <td><strong style="font-family: var(--font-code); color: #818cf8;">${t.id}</strong></td>
      <td style="max-width:280px; text-overflow:ellipsis; overflow:hidden; white-space:nowrap;">${escapeHTML(t.question)}</td>
      <td>${expRoute}</td>
      <td>${actualRouteBadge}</td>
      <td>${expStatus}</td>
      <td>${actualStatusBadge}</td>
      <td>${resultBadge}</td>
      <td>${inspectBtnHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

async function runTestSuite() {
  runSuiteBtn.disabled = true;
  progressBar.style.display = 'block';
  if (progressFill) progressFill.style.width = '20%';
  
  try {
    const res = await fetch('/api/tests/run', { method: 'POST' });
    if (res.ok) {
      pollTestSuiteStatus();
    } else {
      throw new Error("Cannot trigger tests run");
    }
  } catch (err) {
    alert("Không thể chạy bộ Suite: " + err.message);
    runSuiteBtn.disabled = false;
    progressBar.style.display = 'none';
  }
}

async function pollTestSuiteStatus() {
  const poll = setInterval(async () => {
    try {
      const res = await fetch('/api/tests/status');
      if (res.ok) {
        const state = await res.json();
        
        if (!state.is_running) {
          clearInterval(poll);
          if (progressFill) progressFill.style.width = '100%';
          setTimeout(() => {
            progressBar.style.display = 'none';
            runSuiteBtn.disabled = false;
            fetchTests();
          }, 600);
        } else {
          // Mock progress incrementing
          if (progressFill) {
            const currentW = parseFloat(progressFill.style.width);
            if (currentW < 90) {
              progressFill.style.width = (currentW + 5) + '%';
            }
          }
        }
      }
    } catch (err) {
      clearInterval(poll);
      runSuiteBtn.disabled = false;
      progressBar.style.display = 'none';
    }
  }, 2000);
}

// ----------------- TRACE MODAL INSPECTOR -----------------
window.openTraceModal = async function(qid) {
  const mTitle = document.getElementById('modal-title');
  const mQuestion = document.getElementById('modal-meta-question');
  const mRouteOk = document.getElementById('modal-meta-route-ok');
  const mStatusOk = document.getElementById('modal-meta-status-ok');
  const mAnswer = document.getElementById('modal-meta-answer');
  const mTimeline = document.getElementById('modal-trace-timeline');
  
  mTitle.textContent = `Chi tiết vết thực thi - Test Case ${qid}`;
  mQuestion.textContent = 'Đang tải dữ liệu...';
  mAnswer.innerHTML = '<i class="fa-solid fa-circle-notch fa-spin"></i>';
  mTimeline.innerHTML = '';
  mRouteOk.className = 'badge'; mRouteOk.textContent = 'Route';
  mStatusOk.className = 'badge'; mStatusOk.textContent = 'Status';
  
  modal.style.display = 'flex';
  
  try {
    // 1. Fetch test details from cache/UI summary mapping
    const summaryRes = await fetch('/api/tests');
    const summaryData = await summaryRes.json();
    const resultObj = (summaryData.summary.results || []).find(r => r.id === qid);
    
    if (resultObj) {
      mQuestion.textContent = resultObj.question;
      mRouteOk.className = 'badge ' + (resultObj.route_ok ? 'badge-success' : 'badge-danger');
      mRouteOk.textContent = resultObj.route_ok ? 'Route Match' : 'Route Mismatch';
      mStatusOk.className = 'badge ' + (resultObj.status_ok ? 'badge-success' : 'badge-danger');
      mStatusOk.textContent = resultObj.status_ok ? 'Status Match' : 'Status Mismatch';
      mAnswer.textContent = resultObj.final_answer;
    }
    
    // 2. Fetch raw traces trace_Qxx.json
    const traceRes = await fetch(`/api/traces/${qid}`);
    if (traceRes.ok) {
      const traceData = await traceRes.json();
      const traceList = traceData.trace || [];
      
      mTimeline.innerHTML = '';
      traceList.forEach(t => {
        const item = document.createElement('div');
        item.className = 'timeline-item active';
        
        let outputText = '';
        if (t.node === 'supervisor') {
          outputText = JSON.stringify(t.output, null, 2);
        } else if (t.node === 'worker_1_policy') {
          outputText = `Tài liệu trích xuất:\n${JSON.stringify(t.search_results, null, 2)}\n\nKết quả tóm tắt:\n${JSON.stringify(t.output, null, 2)}`;
        } else if (t.node === 'worker_2_data') {
          outputText = `Lịch sử công cụ:\n${JSON.stringify(t.tool_calls, null, 2)}\n\nKết quả dữ liệu:\n${JSON.stringify(t.output, null, 2)}`;
        } else {
          outputText = t.output;
        }
        
        item.innerHTML = `
          <div class="timeline-header">${t.node.toUpperCase()} Node</div>
          <pre class="timeline-content">${escapeHTML(outputText)}</pre>
        `;
        mTimeline.appendChild(item);
      });
      
      if (traceList.length === 0) {
        mTimeline.innerHTML = '<div class="empty-state">Vết log trống.</div>';
      }
    } else {
      mTimeline.innerHTML = '<div class="empty-state">Không thể tải file trace JSON.</div>';
    }
    
  } catch (err) {
    mAnswer.textContent = 'Lỗi: ' + err.message;
    mTimeline.innerHTML = '<div class="empty-state">Lỗi khi tải chi tiết.</div>';
  }
};


// Helpers
function escapeHTML(str) {
  if (!str) return '';
  return str.replace(/[&<>'"]/g, 
    tag => ({
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      "'": '&#39;',
      '"': '&quot;'
    }[tag] || tag)
  );
}
