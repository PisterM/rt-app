(() => {
  'use strict';

  const elements = {
    participant: document.getElementById('participantInput'),
    mode: document.getElementById('modeSelect'),
    action: document.getElementById('actionSelect'),
    trials: document.getElementById('trialsSelect'),
    start: document.getElementById('startButton'),
    reset: document.getElementById('resetButton'),
    export: document.getElementById('exportButton'),
    timer: document.getElementById('timerDisplay'),
    stimulusArea: document.getElementById('stimulusArea'),
    promptPrimary: document.getElementById('promptPrimary'),
    promptSecondary: document.getElementById('promptSecondary'),
    currentMeta: document.getElementById('currentMeta'),
    historyMeta: document.getElementById('historyMeta'),
    trialBody: document.querySelector('#trialTable tbody'),
    historyBody: document.querySelector('#historyTable tbody'),
    circles: [...document.querySelectorAll('.circle')],
  };

  const KEY_MAP = {
    j: { label: 'J', finger: 'index', color: 'red' },
    k: { label: 'K', finger: 'middle', color: 'blue' },
    l: { label: 'L', finger: 'ring', color: 'green' },
  };

  const STIM_TO_KEY = { red: 'j', blue: 'k', green: 'l' };
  const MODE_LABEL = { simple: 'Simple RT', choice: 'Choice RT', discrimination: 'Discrimination RT' };
  const ACTION_LABEL = { release: 'Release key', press: 'Press key' };

  const state = {
    phase: 'idle',
    runNumber: 0,
    currentTrial: 0,
    totalTrials: 10,
    mode: 'simple',
    action: 'release',
    participant: 'Participant 1',
    trialSequence: [],
    records: [],
    history: [],
    expectedKey: null,
    stimulus: null,
    stimulusOnset: null,
    waitingTimer: null,
    getReadyTimer: null,
    timeoutTimer: null,
    timerRaf: null,
    heldKeys: new Set(),
  };

  function formatSeconds(value) {
    if (value === null || value === undefined || Number.isNaN(value)) return '';
    return Number(value).toFixed(3);
  }

  function mean(values) {
    if (!values.length) return null;
    return values.reduce((a, b) => a + b, 0) / values.length;
  }

  function sd(values) {
    if (values.length < 2) return null;
    const m = mean(values);
    const variance = values.reduce((sum, x) => sum + Math.pow(x - m, 2), 0) / (values.length - 1);
    return Math.sqrt(variance);
  }

  function escapeCsv(value) {
    const s = String(value ?? '');
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function setPrompt(primary, secondary = '') {
    elements.promptPrimary.textContent = primary;
    elements.promptSecondary.textContent = secondary;
  }

  function clearTimers() {
    for (const key of ['waitingTimer', 'getReadyTimer', 'timeoutTimer']) {
      if (state[key]) {
        clearTimeout(state[key]);
        state[key] = null;
      }
    }
    if (state.timerRaf) {
      cancelAnimationFrame(state.timerRaf);
      state.timerRaf = null;
    }
  }

  function setControlsEnabled(enabled) {
    elements.participant.disabled = !enabled;
    elements.mode.disabled = !enabled;
    elements.action.disabled = !enabled;
    elements.trials.disabled = !enabled;
    elements.start.disabled = !enabled;
  }

  function setStimulusMode() {
    const simple = elements.mode.value === 'simple';
    elements.stimulusArea.classList.toggle('simple-mode', simple);
    elements.stimulusArea.classList.toggle('three-mode', !simple);
    clearStimulus();
  }

  function clearStimulus() {
    elements.circles.forEach(c => c.classList.remove('on'));
  }

  function showStimulus(color) {
    clearStimulus();
    const circle = elements.circles.find(c => c.dataset.color === color);
    if (circle) circle.classList.add('on');
  }

  function setTimer(value) {
    elements.timer.textContent = formatSeconds(value ?? 0);
  }

  function startLiveTimer() {
    const tick = () => {
      if (state.phase === 'stimulus' && state.stimulusOnset !== null) {
        setTimer((performance.now() - state.stimulusOnset) / 1000);
        state.timerRaf = requestAnimationFrame(tick);
      }
    };
    tick();
  }

  function makeSequence(mode, total) {
    if (mode === 'simple') return Array(total).fill('red');
    const colors = ['red', 'blue', 'green'];
    const arr = [];
    for (let i = 0; i < total; i++) arr.push(colors[i % colors.length]);
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function requiredHoldKeys() {
    if (state.mode === 'simple') return ['j'];
    return ['j', 'k', 'l'];
  }

  function holdPrompt() {
    if (state.mode === 'simple') return 'Hold J key';
    return 'Hold J K L keys';
  }

  function requiredKeysAreHeld() {
    return requiredHoldKeys().every(k => state.heldKeys.has(k));
  }

  function startTest() {
    if (state.phase !== 'idle' && state.phase !== 'finished') return;

    state.participant = elements.participant.value.trim() || 'Participant';
    state.mode = elements.mode.value;
    state.action = elements.action.value;
    state.totalTrials = Number(elements.trials.value);
    state.currentTrial = 0;
    state.records = [];
    state.trialSequence = makeSequence(state.mode, state.totalTrials);
    state.runNumber += 1;
    state.heldKeys.clear();

    elements.trialBody.innerHTML = '';
    state.phase = 'between';
    setControlsEnabled(false);
    setTimer(0);
    clearStimulus();
    updateMeta();

    nextTrial();
  }

  function resetCurrentTest() {
    clearTimers();
    clearStimulus();
    state.phase = 'idle';
    state.currentTrial = 0;
    state.records = [];
    state.trialSequence = [];
    state.expectedKey = null;
    state.stimulus = null;
    state.stimulusOnset = null;
    state.heldKeys.clear();
    elements.trialBody.innerHTML = '';
    setTimer(0);
    setControlsEnabled(true);
    setPrompt('Ready', 'Press Space or Start to begin.');
    updateMeta();
  }

  function nextTrial() {
    clearTimers();
    clearStimulus();
    setTimer(0);

    if (state.currentTrial >= state.totalTrials) {
      finishTest();
      return;
    }

    state.stimulus = state.trialSequence[state.currentTrial];
    state.expectedKey = STIM_TO_KEY[state.stimulus];
    state.currentTrial += 1;

    updateMeta();

    if (state.action === 'release') {
      state.phase = 'hold';
      setPrompt(holdPrompt(), 'Keep the key/s held until a circle lights.');
      if (requiredKeysAreHeld()) prepareTrial();
    } else {
      state.phase = 'get-ready';
      prepareTrial();
    }
  }

  function prepareTrial() {
    if (state.phase !== 'hold' && state.phase !== 'get-ready') return;

    state.phase = 'get-ready';
    setPrompt('Get ready', '');
    clearStimulus();

    state.getReadyTimer = setTimeout(() => {
      state.getReadyTimer = null;
      setPrompt('', '');
      state.phase = 'waiting';

      const delay = 900 + Math.random() * 1800;
      state.waitingTimer = setTimeout(() => {
        state.waitingTimer = null;
        presentStimulus();
      }, delay);
    }, 1000);
  }

  function presentStimulus() {
    state.phase = 'stimulus';
    state.stimulusOnset = performance.now();
    showStimulus(state.stimulus);
    startLiveTimer();

    if (state.mode === 'discrimination' && state.stimulus !== 'red') {
      state.timeoutTimer = setTimeout(() => {
        recordTrial({
          stimulus: state.stimulus,
          expected: 'No response',
          response: 'No response',
          rt: null,
          correct: true,
          result: 'Correct no-go',
        });
        nextTrial();
      }, 1200);
    }
  }

  function recordTrial(record) {
    clearTimers();
    clearStimulus();
    state.records.push(record);
    appendTrialRow(record, state.records.length);
    updateMeta();
  }

  function appendTrialRow(record, trialNumber) {
    const tr = document.createElement('tr');
    const resultClass = record.correct ? 'result-correct' : (record.result === 'Miss' ? 'result-miss' : 'result-incorrect');
    tr.innerHTML = `
      <td>${trialNumber}</td>
      <td>${record.stimulus}</td>
      <td>${record.expected}</td>
      <td>${record.response}</td>
      <td>${formatSeconds(record.rt)}</td>
      <td class="${resultClass}">${record.result}</td>
    `;
    elements.trialBody.appendChild(tr);
  }

  function responseLabel(key) {
    if (!key || !KEY_MAP[key]) return '';
    return KEY_MAP[key].label;
  }

  function handleResponse(key, eventType) {
    if (!['j', 'k', 'l'].includes(key)) return;

    const isRelevantEvent = (state.action === 'press' && eventType === 'down') || (state.action === 'release' && eventType === 'up');
    if (!isRelevantEvent) return;

    if (state.phase === 'waiting' || state.phase === 'get-ready') {
      if (state.action === 'press' || !requiredKeysAreHeld()) {
        recordTrial({
          stimulus: state.stimulus ?? '',
          expected: responseLabel(state.expectedKey),
          response: responseLabel(key),
          rt: null,
          correct: false,
          result: 'False start',
        });
        nextTrial();
      }
      return;
    }

    if (state.phase !== 'stimulus') return;

    const rt = (performance.now() - state.stimulusOnset) / 1000;

    if (state.mode === 'discrimination' && state.stimulus !== 'red') {
      recordTrial({
        stimulus: state.stimulus,
        expected: 'No response',
        response: responseLabel(key),
        rt,
        correct: false,
        result: 'Incorrect response',
      });
      nextTrial();
      return;
    }

    const correct = key === state.expectedKey;
    recordTrial({
      stimulus: state.stimulus,
      expected: responseLabel(state.expectedKey),
      response: responseLabel(key),
      rt,
      correct,
      result: correct ? 'Correct' : 'Incorrect',
    });
    nextTrial();
  }

  function finishTest() {
    clearTimers();
    clearStimulus();
    state.phase = 'finished';
    setControlsEnabled(true);
    setPrompt('Finished', '');
    setTimer(0);

    const validCorrectRts = state.records
      .filter(r => r.correct && typeof r.rt === 'number')
      .map(r => r.rt);

    const correctTrials = state.records.filter(r => r.correct).length;
    const incorrectTrials = state.records.length - correctTrials;
    const summary = {
      runNumber: state.runNumber,
      participant: state.participant,
      mode: MODE_LABEL[state.mode],
      action: ACTION_LABEL[state.action],
      trialsDone: state.records.length,
      correctTrials,
      incorrectTrials,
      meanRt: mean(validCorrectRts),
      sdRt: sd(validCorrectRts),
    };

    state.history.push(summary);
    appendSummaryRow(summary);
    appendHistoryRow(summary);
    updateMeta();
  }

  function appendSummaryRow(summary) {
    const tr = document.createElement('tr');
    tr.className = 'summary-row';
    tr.innerHTML = `
      <td>Summary</td>
      <td colspan="3">Correct ${summary.correctTrials} / Incorrect ${summary.incorrectTrials}</td>
      <td>${formatSeconds(summary.meanRt)}</td>
      <td>SD ${formatSeconds(summary.sdRt)}</td>
    `;
    elements.trialBody.appendChild(tr);
  }

  function appendHistoryRow(summary) {
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${summary.runNumber}</td>
      <td>${summary.participant}</td>
      <td>${summary.mode}</td>
      <td>${summary.action}</td>
      <td>${summary.trialsDone}</td>
      <td>${summary.correctTrials}</td>
      <td>${summary.incorrectTrials}</td>
      <td>${formatSeconds(summary.meanRt)}</td>
      <td>${formatSeconds(summary.sdRt)}</td>
    `;
    elements.historyBody.appendChild(tr);
  }

  function updateMeta() {
    if (state.phase === 'idle' || state.phase === 'finished') {
      elements.currentMeta.textContent = state.records.length ? `${state.records.length} trials complete` : 'No test running';
    } else {
      elements.currentMeta.textContent = `Run ${state.runNumber} · Trial ${Math.min(state.currentTrial, state.totalTrials)} of ${state.totalTrials}`;
    }
    elements.historyMeta.textContent = `${state.history.length} run${state.history.length === 1 ? '' : 's'}`;
  }

  function exportCsv() {
    if (!state.history.length) {
      alert('No completed test history to export yet.');
      return;
    }

    const headers = [
      'Run number', 'Participant', 'RT Mode', 'Action', 'Trials done',
      'Correct Trials', 'Incorrect Trials', 'Mean RT (s)', 'SD (s)'
    ];

    const rows = state.history.map(h => [
      h.runNumber, h.participant, h.mode, h.action, h.trialsDone,
      h.correctTrials, h.incorrectTrials, formatSeconds(h.meanRt), formatSeconds(h.sdRt)
    ]);

    const csv = [headers, ...rows].map(row => row.map(escapeCsv).join(',')).join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    const a = document.createElement('a');
    a.href = url;
    a.download = `RT App Results ${stamp}.csv`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  }

  window.addEventListener('keydown', (event) => {
    const key = event.key.toLowerCase();

    if (key === ' ' || event.code === 'Space') {
      event.preventDefault();
      if (state.phase === 'idle' || state.phase === 'finished') startTest();
      return;
    }

    if (!['j', 'k', 'l'].includes(key)) return;

    if (!event.repeat) state.heldKeys.add(key);
    handleResponse(key, 'down');
  });

  window.addEventListener('keyup', (event) => {
    const key = event.key.toLowerCase();
    if (!['j', 'k', 'l'].includes(key)) return;

    if (state.phase === 'stimulus') {
      handleResponse(key, 'up');
      state.heldKeys.delete(key);
    } else {
      state.heldKeys.delete(key);
      handleResponse(key, 'up');
    }
  });

  setInterval(() => {
    if (state.action === 'release' && state.phase === 'hold' && requiredKeysAreHeld()) {
      prepareTrial();
    }
  }, 40);

  elements.start.addEventListener('click', startTest);
  elements.reset.addEventListener('click', resetCurrentTest);
  elements.export.addEventListener('click', exportCsv);
  elements.mode.addEventListener('change', setStimulusMode);

  setStimulusMode();
  updateMeta();
})();
