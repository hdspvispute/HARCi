/**
 * AMS — Agent Management System
 * Pricing Calculator & Interactive Features
 * Static JavaScript — no build tools, no dependencies
 */

'use strict';

/* ================================================================
   CONSTANTS & PRICING DATA
   ================================================================ */

const PLAN_DEFINITIONS = {
  starter: {
    id: 'starter',
    label: 'Starter',
    baseFee: 2500,
    description: 'Best for teams beginning AI agent governance',
  },
  professional: {
    id: 'professional',
    label: 'Professional',
    baseFee: 7500,
    description: 'Best for enterprise teams scaling AgentOps',
  },
  enterprise: {
    id: 'enterprise',
    label: 'Enterprise',
    baseFee: 18000,
    description: 'Best for large enterprise AI control plane',
  },
};

const PRICING_RATES = {
  userPerMonth: 12,          // $ per user/month
  agentPerMonth: 20,         // $ per agent/month
  sessionIncluded: 100000,   // sessions included in base
  sessionOveragePer1k: 0.80, // $ per 1,000 sessions above included
  telemetryPerGB: 0.12,      // $ per GB telemetry
  retention: {
    30: 1.0,
    60: 1.2,
    90: 1.5,
    180: 2.2,
  },
  llmIntelligence: {
    off: 0,
    standard: 300,
    advanced: 1500,
    premium: 4000,
  },
  fortifyScans: {
    basic: 2,
    standard: 8,
    deep: 25,
  },
  engObsPerDev: 8,           // $ per developer/month
  deployment: {
    saas: 1.0,
    'private-saas': 1.25,
    'self-hosted': 1.4,
  },
  support: {
    standard: 1.0,
    premium: 1.15,
    dedicated: 1.3,
  },
};

const OPTIMIZATION_SUGGESTIONS = {
  highRetention: 'Reduce telemetry retention for non-production agents to lower Command Center storage costs.',
  highSessions: 'Use event-based sampling for low-priority agents to reduce session volume.',
  deepScans: 'Reserve deep FortifyOps scans for production and critical agents; use Basic for dev/test.',
  highLLM: 'Start with Standard LLM intelligence and upgrade to Advanced or Premium for production workloads.',
  manyDevs: 'Tier engineering observability by team; not all developers require full-depth analytics.',
  privateDeployment: 'Evaluate SaaS deployment for non-regulated workloads to reduce the deployment multiplier.',
  dedicatedSupport: 'Consider Standard or Premium support for pilot phases and upgrade to Dedicated at scale.',
  highAgents: 'Separate pilot agents from enterprise-critical agents to optimize registry and scan scope.',
  highTelemetry: 'Enable telemetry filtering and aggregation to reduce raw ingest volume into Command Center.',
  highUsers: 'Apply RBAC to scope AMS users by module rather than granting full-platform access to all.',
};

/* ================================================================
   UTILITY HELPERS
   ================================================================ */

/**
 * Format a number as USD currency string (no cents for whole numbers)
 * @param {number} amount
 * @returns {string}
 */
function formatCurrency(amount) {
  if (amount === 0) return '$0';
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(Math.round(amount));
}

/**
 * Format a number with thousands separators
 * @param {number} n
 * @returns {string}
 */
function formatNumber(n) {
  return new Intl.NumberFormat('en-US').format(n);
}

/**
 * Clamp a value between min and max
 * @param {number} val
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function clamp(val, min, max) {
  return Math.max(min, Math.min(max, val));
}

/* ================================================================
   INPUT READING
   ================================================================ */

/**
 * Read all calculator input values and return a clean object.
 * Falls back to default values if inputs are invalid.
 * @returns {Object}
 */
function getInputValues() {
  const safeInt = (id, fallback, min = 0) => {
    const el = document.getElementById(id);
    if (!el) return fallback;
    const val = parseInt(el.value, 10);
    return isNaN(val) ? fallback : Math.max(min, val);
  };

  const safeSelect = (id, fallback) => {
    const el = document.getElementById(id);
    return el ? (el.value || fallback) : fallback;
  };

  return {
    numUsers: safeInt('numUsers', 50, 1),
    numAgents: safeInt('numAgents', 100, 1),
    numSessions: safeInt('numSessions', 100000, 0),
    telemetryGB: safeInt('telemetryGB', 50, 0),
    numScans: safeInt('numScans', 50, 0),
    numDevs: safeInt('numDevs', 25, 0),
    deploymentType: safeSelect('deploymentType', 'saas'),
    retentionDays: parseInt(safeSelect('retentionDays', '30'), 10),
    llmLevel: safeSelect('llmLevel', 'standard'),
    scanDepth: safeSelect('scanDepth', 'standard'),
    supportTier: safeSelect('supportTier', 'standard'),
  };
}

/* ================================================================
   PLAN RECOMMENDATION
   ================================================================ */

/**
 * Recommend the appropriate plan based on usage inputs.
 * @param {Object} inputs - from getInputValues()
 * @returns {'starter'|'professional'|'enterprise'}
 */
function recommendPlan(inputs) {
  const { numUsers, numAgents, numSessions, deploymentType, supportTier } = inputs;

  // Enterprise conditions
  if (
    deploymentType === 'private-saas' ||
    deploymentType === 'self-hosted' ||
    supportTier === 'dedicated' ||
    numUsers > 500 ||
    numAgents > 1000 ||
    numSessions > 2000000
  ) {
    return 'enterprise';
  }

  // Starter conditions
  if (numUsers <= 50 && numAgents <= 100 && numSessions <= 100000) {
    return 'starter';
  }

  // Professional — everything in between
  return 'professional';
}

/* ================================================================
   COST CALCULATION FUNCTIONS
   ================================================================ */

/**
 * Base platform fee for the recommended plan.
 * @param {string} plan - 'starter' | 'professional' | 'enterprise'
 * @returns {number}
 */
function calculateBaseCost(plan) {
  return PLAN_DEFINITIONS[plan]?.baseFee ?? 0;
}

/**
 * Monthly cost for AMS users.
 * @param {number} users
 * @returns {number}
 */
function calculateUserCost(users) {
  return users * PRICING_RATES.userPerMonth;
}

/**
 * Monthly cost for active agents.
 * @param {number} activeAgents
 * @returns {number}
 */
function calculateAgentCost(activeAgents) {
  return activeAgents * PRICING_RATES.agentPerMonth;
}

/**
 * Monthly cost for agent sessions/runs.
 * First 100,000 sessions are included in base; overage is $0.80 / 1,000 sessions.
 * @param {number} monthlySessions
 * @returns {number}
 */
function calculateSessionCost(monthlySessions) {
  const overage = Math.max(0, monthlySessions - PRICING_RATES.sessionIncluded);
  return (overage / 1000) * PRICING_RATES.sessionOveragePer1k;
}

/**
 * Monthly cost for telemetry ingest and retention.
 * @param {number} telemetryGB
 * @param {number} retentionDays - 30 | 60 | 90 | 180
 * @returns {number}
 */
function calculateTelemetryCost(telemetryGB, retentionDays) {
  const baseIngest = telemetryGB * PRICING_RATES.telemetryPerGB;
  const retentionMultiplier = PRICING_RATES.retention[retentionDays] ?? 1.0;
  return baseIngest * retentionMultiplier;
}

/**
 * Monthly cost for LLM intelligence level.
 * @param {string} level - 'off' | 'standard' | 'advanced' | 'premium'
 * @returns {number}
 */
function calculateLLMIntelligenceCost(level) {
  return PRICING_RATES.llmIntelligence[level] ?? 0;
}

/**
 * Monthly cost for FortifyOps scans.
 * @param {number} scans
 * @param {string} scanDepth - 'basic' | 'standard' | 'deep'
 * @returns {number}
 */
function calculateFortifyOpsCost(scans, scanDepth) {
  const ratePerScan = PRICING_RATES.fortifyScans[scanDepth] ?? PRICING_RATES.fortifyScans.standard;
  return scans * ratePerScan;
}

/**
 * Monthly cost for Engineering Observability (Copilot, Cursor, etc.)
 * @param {number} developers
 * @returns {number}
 */
function calculateEngineeringObservabilityCost(developers) {
  return developers * PRICING_RATES.engObsPerDev;
}

/**
 * Apply deployment-type and support-tier multipliers to a subtotal.
 * @param {number} subtotal
 * @param {string} deploymentType - 'saas' | 'private-saas' | 'self-hosted'
 * @param {string} supportTier - 'standard' | 'premium' | 'dedicated'
 * @returns {number}
 */
function applyDeploymentAndSupportMultiplier(subtotal, deploymentType, supportTier) {
  const deployMul = PRICING_RATES.deployment[deploymentType] ?? 1.0;
  const supportMul = PRICING_RATES.support[supportTier] ?? 1.0;
  const combinedMul = deployMul * supportMul;
  // The adjustment is the additional cost (above 1.0×)
  return subtotal * combinedMul;
}

/* ================================================================
   MASTER CALCULATION
   ================================================================ */

/**
 * Run the full pricing calculation and return a structured result.
 * @returns {Object} Detailed cost breakdown and recommendations
 */
function calculateTotal() {
  const inputs = getInputValues();
  const plan = recommendPlan(inputs);

  const baseCost      = calculateBaseCost(plan);
  const userCost      = calculateUserCost(inputs.numUsers);
  const agentCost     = calculateAgentCost(inputs.numAgents);
  const sessionCost   = calculateSessionCost(inputs.numSessions);
  const telemetryCost = calculateTelemetryCost(inputs.telemetryGB, inputs.retentionDays);
  const llmCost       = calculateLLMIntelligenceCost(inputs.llmLevel);
  const fortifyCost   = calculateFortifyOpsCost(inputs.numScans, inputs.scanDepth);
  const engObsCost    = calculateEngineeringObservabilityCost(inputs.numDevs);

  // Subtotal before deployment/support multipliers
  const subtotal = baseCost + userCost + agentCost + sessionCost + telemetryCost + llmCost + fortifyCost + engObsCost;

  // Apply multipliers — calculate adjustment delta
  const totalWithMul = applyDeploymentAndSupportMultiplier(subtotal, inputs.deploymentType, inputs.supportTier);
  const adjustmentCost = totalWithMul - subtotal;

  const monthlyTotal = totalWithMul;
  const annualTotal  = monthlyTotal * 12;

  const breakdown = [
    { label: 'Platform base (' + PLAN_DEFINITIONS[plan].label + ')', amount: baseCost },
    { label: 'AMS users (' + formatNumber(inputs.numUsers) + ' users)', amount: userCost },
    { label: 'Active agents (' + formatNumber(inputs.numAgents) + ' agents)', amount: agentCost },
    { label: 'Agent sessions', amount: sessionCost },
    { label: 'Command Center telemetry & cost intelligence', amount: telemetryCost },
    { label: 'LLM intelligence (' + inputs.llmLevel + ')', amount: llmCost },
    { label: 'FortifyOps scans (' + inputs.scanDepth + ')', amount: fortifyCost },
    { label: 'Engineering observability (' + formatNumber(inputs.numDevs) + ' devs)', amount: engObsCost },
    { label: 'Deployment & support adjustment', amount: adjustmentCost },
  ];

  return {
    inputs,
    plan,
    baseCost,
    userCost,
    agentCost,
    sessionCost,
    telemetryCost,
    llmCost,
    fortifyCost,
    engObsCost,
    adjustmentCost,
    subtotal,
    monthlyTotal,
    annualTotal,
    breakdown,
  };
}

/* ================================================================
   TOP COST DRIVERS
   ================================================================ */

/**
 * Identify the top N cost drivers from the breakdown.
 * @param {Array} breakdown - array of {label, amount}
 * @param {number} n - number of top drivers to return
 * @returns {Array} sorted top drivers with percentage
 */
function getTopCostDrivers(breakdown, total, n = 3) {
  return [...breakdown]
    .filter(item => item.amount > 0)
    .sort((a, b) => b.amount - a.amount)
    .slice(0, n)
    .map(item => ({
      label: item.label,
      amount: item.amount,
      pct: total > 0 ? Math.round((item.amount / total) * 100) : 0,
    }));
}

/* ================================================================
   OPTIMIZATION SUGGESTIONS
   ================================================================ */

/**
 * Generate context-aware optimization suggestions based on inputs and breakdown.
 * @param {Object} result - from calculateTotal()
 * @returns {string[]}
 */
function getOptimizationSuggestions(result) {
  const { inputs, monthlyTotal } = result;
  const suggestions = [];

  // Retention suggestion
  if (inputs.retentionDays >= 90) {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.highRetention);
  }

  // Session volume suggestion
  if (inputs.numSessions > 500000) {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.highSessions);
  }

  // Deep scan suggestion
  if (inputs.scanDepth === 'deep' && inputs.numScans > 20) {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.deepScans);
  }

  // LLM intelligence suggestion
  if (inputs.llmLevel === 'premium' || inputs.llmLevel === 'advanced') {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.highLLM);
  }

  // Engineering observability suggestion
  if (inputs.numDevs > 100) {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.manyDevs);
  }

  // Private deployment suggestion
  if (inputs.deploymentType === 'private-saas' || inputs.deploymentType === 'self-hosted') {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.privateDeployment);
  }

  // Dedicated support suggestion
  if (inputs.supportTier === 'dedicated') {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.dedicatedSupport);
  }

  // Many agents suggestion
  if (inputs.numAgents > 500) {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.highAgents);
  }

  // High telemetry suggestion
  if (inputs.telemetryGB > 200) {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.highTelemetry);
  }

  // High users suggestion
  if (inputs.numUsers > 200) {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.highUsers);
  }

  // Return up to 5 suggestions, always at least 1
  if (suggestions.length === 0) {
    suggestions.push(OPTIMIZATION_SUGGESTIONS.highRetention);
  }

  return suggestions.slice(0, 5);
}

/* ================================================================
   RENDER FUNCTIONS
   ================================================================ */

/**
 * Render the cost breakdown bars into the DOM.
 * @param {Array} breakdown
 * @param {number} total
 */
function renderBreakdown(breakdown, total) {
  const container = document.getElementById('breakdownList');
  if (!container) return;

  const maxAmount = Math.max(...breakdown.map(b => b.amount), 1);

  container.innerHTML = breakdown
    .filter(item => item.amount >= 0)
    .map(item => {
      const barWidth = total > 0 ? Math.round((item.amount / maxAmount) * 100) : 0;
      return `
        <div class="breakdown-item" role="listitem">
          <span class="breakdown-label">${escapeHtml(item.label)}</span>
          <span class="breakdown-amount">${formatCurrency(item.amount)}</span>
          <div class="breakdown-bar-wrap" aria-hidden="true">
            <div class="breakdown-bar" style="width: ${barWidth}%"></div>
          </div>
        </div>
      `;
    })
    .join('');
}

/**
 * Render the top cost drivers list.
 * @param {Array} drivers
 */
function renderTopCostDrivers(drivers) {
  const container = document.getElementById('driversList');
  if (!container) return;

  container.innerHTML = drivers
    .map((driver, i) => `
      <li class="driver-item">
        <span class="driver-rank" aria-label="Rank ${i + 1}">${i + 1}</span>
        <span>${escapeHtml(driver.label)}</span>
        <span class="driver-pct" aria-label="${driver.pct}% of total">${driver.pct}%</span>
      </li>
    `)
    .join('');
}

/**
 * Render optimization suggestions list.
 * @param {string[]} suggestions
 */
function renderOptimizationSuggestions(suggestions) {
  const container = document.getElementById('suggestionsList');
  if (!container) return;

  container.innerHTML = suggestions
    .map(s => `<li class="suggestion-item" role="listitem">${escapeHtml(s)}</li>`)
    .join('');
}

/**
 * Simple HTML escape to prevent XSS when rendering user-derived strings.
 * @param {string} str
 * @returns {string}
 */
function escapeHtml(str) {
  const div = document.createElement('div');
  div.textContent = str;
  return div.innerHTML;
}

/* ================================================================
   MAIN RENDER ENTRY POINT
   ================================================================ */

/**
 * Run the full calculation and update all result DOM elements.
 */
function runCalculation() {
  const result = calculateTotal();
  const { plan, monthlyTotal, annualTotal, breakdown } = result;

  const drivers = getTopCostDrivers(breakdown, monthlyTotal);
  const suggestions = getOptimizationSuggestions(result);

  // Show results, hide placeholder
  const placeholder = document.getElementById('resultsPlaceholder');
  const content = document.getElementById('resultsContent');
  if (placeholder) placeholder.hidden = true;
  if (content) content.hidden = false;

  // Plan badge
  const planEl = document.getElementById('resultsPlan');
  if (planEl) {
    const planDef = PLAN_DEFINITIONS[plan];
    planEl.textContent = `Recommended Plan: ${planDef.label} — ${planDef.description}`;
  }

  // Cost figures
  const monthlyEl = document.getElementById('costMonthly');
  const annualEl  = document.getElementById('costAnnual');
  if (monthlyEl) animateCounter(monthlyEl, monthlyTotal);
  if (annualEl)  annualEl.textContent = formatCurrency(annualTotal) + ' / year';

  // Breakdown, drivers, suggestions
  renderBreakdown(breakdown, monthlyTotal);
  renderTopCostDrivers(drivers);
  renderOptimizationSuggestions(suggestions);

  // Store last result for export
  window._amsLastResult = result;
}

/* ================================================================
   COUNTER ANIMATION
   ================================================================ */

/**
 * Animate a numeric counter in a DOM element from 0 to the target.
 * @param {HTMLElement} el
 * @param {number} target
 * @param {number} duration - ms
 */
function animateCounter(el, target, duration = 600) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = formatCurrency(target);
    return;
  }

  const start = performance.now();
  const initial = 0;

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    // Ease out cubic
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = initial + (target - initial) * eased;
    el.textContent = formatCurrency(current);
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

/* ================================================================
   HERO STAT COUNTERS
   ================================================================ */

/**
 * Animate hero stat numbers when they enter the viewport.
 */
function initHeroCounters() {
  const statEls = document.querySelectorAll('.stat-num[data-target]');
  if (!statEls.length) return;

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const el = entry.target;
          const target = parseInt(el.dataset.target, 10);
          if (!isNaN(target)) {
            animateStatCounter(el, target);
            observer.unobserve(el);
          }
        }
      });
    },
    { threshold: 0.5 }
  );

  statEls.forEach(el => observer.observe(el));
}

/**
 * Animate a stat counter element.
 * @param {HTMLElement} el
 * @param {number} target
 */
function animateStatCounter(el, target) {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    el.textContent = target;
    return;
  }

  const duration = 1200;
  const start = performance.now();

  function step(now) {
    const elapsed = now - start;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = Math.round(target * eased);
    el.textContent = current;
    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

/* ================================================================
   RESET CALCULATOR
   ================================================================ */

/**
 * Reset all calculator inputs to their default values and clear results.
 */
function resetCalculator() {
  const defaults = {
    numUsers: 50,
    numAgents: 100,
    numSessions: 100000,
    telemetryGB: 50,
    numScans: 50,
    numDevs: 25,
    deploymentType: 'saas',
    retentionDays: '30',
    llmLevel: 'standard',
    scanDepth: 'standard',
    supportTier: 'standard',
  };

  Object.entries(defaults).forEach(([id, val]) => {
    const el = document.getElementById(id);
    if (el) el.value = val;
  });

  // Reset results display
  const placeholder = document.getElementById('resultsPlaceholder');
  const content = document.getElementById('resultsContent');
  if (placeholder) placeholder.hidden = false;
  if (content) content.hidden = true;

  window._amsLastResult = null;

  // Close advanced panel if open
  const panel = document.getElementById('advancedPanel');
  const toggle = document.getElementById('advancedToggle');
  if (panel) panel.hidden = true;
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

/* ================================================================
   EXPORT ESTIMATE
   ================================================================ */

/**
 * Export the current estimate as a downloadable text file.
 */
function exportEstimate() {
  const result = window._amsLastResult;
  if (!result) {
    alert('Please run a calculation first before exporting.');
    return;
  }

  const { inputs, plan, monthlyTotal, annualTotal, breakdown } = result;
  const planDef = PLAN_DEFINITIONS[plan];
  const now = new Date().toISOString().slice(0, 10);

  const lines = [
    '=======================================================',
    '  AMS — Agent Management System',
    '  Pricing Estimate Export',
    `  Generated: ${now}`,
    '=======================================================',
    '',
    'DISCLAIMER: This is a directional pricing estimate for',
    'planning and discussion purposes only. Final pricing',
    'depends on contract terms, deployment model, data',
    'residency, integration scope, and support level.',
    '',
    '--- SELECTED INPUTS ---',
    `AMS Users:                    ${formatNumber(inputs.numUsers)}`,
    `Active AI Agents:             ${formatNumber(inputs.numAgents)}`,
    `Monthly Agent Sessions:       ${formatNumber(inputs.numSessions)}`,
    `Monthly Telemetry Volume:     ${formatNumber(inputs.telemetryGB)} GB`,
    `FortifyOps Scans / Month:     ${formatNumber(inputs.numScans)}`,
    `Developers (Eng Obs):         ${formatNumber(inputs.numDevs)}`,
    `Deployment Type:              ${inputs.deploymentType}`,
    `Telemetry Retention:          ${inputs.retentionDays} days`,
    `LLM Intelligence:             ${inputs.llmLevel}`,
    `Scan Depth:                   ${inputs.scanDepth}`,
    `Support Tier:                 ${inputs.supportTier}`,
    '',
    '--- RECOMMENDED PLAN ---',
    `Plan:                         ${planDef.label}`,
    `Description:                  ${planDef.description}`,
    '',
    '--- COST ESTIMATE ---',
    `Estimated Monthly Cost:       ${formatCurrency(monthlyTotal)}`,
    `Estimated Annual Cost:        ${formatCurrency(annualTotal)}`,
    '',
    '--- MODULE BREAKDOWN ---',
    ...breakdown.map(item =>
      `${item.label.padEnd(44)} ${formatCurrency(item.amount)}`
    ),
    '',
    '--- JSON EXPORT ---',
    JSON.stringify({
      generatedOn: now,
      inputs,
      recommendedPlan: plan,
      estimatedMonthlyUSD: Math.round(monthlyTotal),
      estimatedAnnualUSD: Math.round(annualTotal),
      breakdown: breakdown.map(b => ({
        label: b.label,
        amountUSD: Math.round(b.amount),
      })),
    }, null, 2),
    '',
    '=======================================================',
    '  ams-platform.io | Agent Management System',
    '=======================================================',
  ];

  const content = lines.join('\n');
  const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  const a = document.createElement('a');
  a.href = url;
  a.download = `ams-pricing-estimate-${now}.txt`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/* ================================================================
   NAVIGATION — STICKY + MOBILE TOGGLE
   ================================================================ */

function initNavigation() {
  const nav = document.getElementById('nav');
  const toggle = document.getElementById('navToggle');
  const links = document.getElementById('navLinks');

  // Sticky scroll class
  if (nav) {
    const handleScroll = () => {
      if (window.scrollY > 20) {
        nav.classList.add('nav--scrolled');
      } else {
        nav.classList.remove('nav--scrolled');
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    handleScroll();
  }

  // Mobile toggle
  if (toggle && links) {
    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      links.classList.toggle('nav-links--open', !expanded);
    });

    // Close on link click
    links.querySelectorAll('a').forEach(link => {
      link.addEventListener('click', () => {
        toggle.setAttribute('aria-expanded', 'false');
        links.classList.remove('nav-links--open');
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target)) {
        toggle.setAttribute('aria-expanded', 'false');
        links.classList.remove('nav-links--open');
      }
    });
  }

  // Active link highlighting on scroll
  const sections = document.querySelectorAll('section[id]');
  if (sections.length) {
    const navLinkEls = document.querySelectorAll('.nav-link');
    const activateLink = () => {
      let current = '';
      sections.forEach(section => {
        const top = section.offsetTop - 100;
        if (window.scrollY >= top) current = section.id;
      });
      navLinkEls.forEach(link => {
        link.classList.toggle(
          'nav-link--active',
          link.getAttribute('href') === `#${current}`
        );
      });
    };
    window.addEventListener('scroll', activateLink, { passive: true });
  }
}

/* ================================================================
   ADVANCED SETTINGS TOGGLE
   ================================================================ */

function initAdvancedToggle() {
  const toggle = document.getElementById('advancedToggle');
  const panel  = document.getElementById('advancedPanel');
  if (!toggle || !panel) return;

  toggle.addEventListener('click', () => {
    const expanded = toggle.getAttribute('aria-expanded') === 'true';
    toggle.setAttribute('aria-expanded', String(!expanded));
    panel.hidden = expanded;
  });
}

/* ================================================================
   CALCULATOR EVENT WIRING
   ================================================================ */

function initCalculator() {
  const calcBtn   = document.getElementById('calculateBtn');
  const resetBtn  = document.getElementById('resetBtn');
  const exportBtn = document.getElementById('exportBtn');

  if (calcBtn)  calcBtn.addEventListener('click', runCalculation);
  if (resetBtn) resetBtn.addEventListener('click', resetCalculator);
  if (exportBtn) exportBtn.addEventListener('click', exportEstimate);

  // Live update on input changes (debounced)
  const inputIds = ['numUsers', 'numAgents', 'numSessions', 'telemetryGB', 'numScans', 'numDevs'];
  const selectIds = ['deploymentType', 'retentionDays', 'llmLevel', 'scanDepth', 'supportTier'];

  let debounceTimer = null;
  const debounceUpdate = () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      if (window._amsLastResult !== undefined && window._amsLastResult !== null) {
        runCalculation();
      }
    }, 300);
  };

  inputIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('input', debounceUpdate);
  });

  selectIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.addEventListener('change', debounceUpdate);
  });
}

/* ================================================================
   SECTION REVEAL ANIMATION (Intersection Observer)
   ================================================================ */

function initSectionReveal() {
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const targets = document.querySelectorAll(
    '.problem-card, .module-card, .pricing-card, .deploy-card, .comp-summary'
  );

  const observer = new IntersectionObserver(
    (entries) => {
      entries.forEach((entry, i) => {
        if (entry.isIntersecting) {
          entry.target.style.animationDelay = `${i * 60}ms`;
          entry.target.classList.add('animate-fade-up');
          observer.unobserve(entry.target);
        }
      });
    },
    { threshold: 0.1, rootMargin: '0px 0px -40px 0px' }
  );

  targets.forEach(el => observer.observe(el));
}

/* ================================================================
   ORBIT NODE HOVER TOOLTIPS (simple aria-label enhancement)
   ================================================================ */

function initOrbitNodes() {
  const nodes = document.querySelectorAll('.orbit-node');
  nodes.forEach(node => {
    const module = node.dataset.module;
    if (module) {
      node.setAttribute('title', getModuleFullName(module));
    }
  });
}

function getModuleFullName(abbr) {
  const map = {
    ARE: 'Agent Registration Engine',
    CC:  'Command Center',
    CP:  'Control Plane',
    FO:  'FortifyOps',
    EO:  'Engineering Observability',
  };
  return map[abbr] || abbr;
}

/* ================================================================
   INITIALIZATION
   ================================================================ */

document.addEventListener('DOMContentLoaded', () => {
  initNavigation();
  initAdvancedToggle();
  initCalculator();
  initHeroCounters();
  initSectionReveal();
  initOrbitNodes();

  // Mark as initialized
  window._amsLastResult = null;
});
