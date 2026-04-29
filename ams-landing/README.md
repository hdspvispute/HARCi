# AMS — Agent Management System
## Enterprise AgentOps Landing Page & SaaS Pricing Calculator

A professional, futuristic, static landing page for **AMS — Agent Management System**, including an interactive **AMS SaaS Pricing Calculator**.

Designed for GitHub Pages hosting. No build tools. No paid dependencies. Runs directly from the browser.

---

## What Is AMS?

**AMS (Agent Management System)** is an enterprise-grade platform for managing AI agents across an organization.

> "Unified AgentOps, Governance, Security, Observability, and Control Plane for Enterprise AI Agents."

AMS helps enterprises:
- Register and inventory AI agents across runtimes and business units
- Discover agent sprawl and gain governance visibility
- Monitor agent health, logs, traces, metrics, sessions, failures, and costs
- Control agent runtime lifecycle — start, stop, scale, onboard, offboard
- Secure agents through FortifyOps scans
- Observe engineering AI tool usage such as GitHub Copilot and Cursor
- Track LLM costs, telemetry volume, and platform usage

---

## The 5 AMS Core Modules

AMS has exactly **five core modules**. There is no sixth.

| # | Module | Purpose |
|---|--------|---------|
| 1 | **Agent Registration Engine (ARE)** | Enterprise agent inventory, ownership, metadata, lifecycle |
| 2 | **Command Center** | Unified observability — logs, traces, metrics, sessions, failures, health, cost & performance intelligence |
| 3 | **Control Plane** | Runtime lifecycle management — start, stop, scale, sync, onboard, offboard |
| 4 | **FortifyOps** | Agent-native security scans — prompt risk, tool access, policy checks, red-team style scanning |
| 5 | **Engineering Observability** | GitHub Copilot, Cursor, code-assist events, acceptance rates, developer productivity analytics |

> **Important:** Cost and performance intelligence is part of **Command Center**. It is not a separate module.

---

## Project Structure

```
ams-landing/
├── index.html     — Full semantic landing page (9 sections)
├── styles.css     — Complete responsive CSS (dark futuristic theme)
├── script.js      — Pricing calculator logic and interactive behavior
└── README.md      — This file
```

---

## Landing Page Sections

1. **Sticky Navigation** — Logo, nav links, CTA button
2. **Hero** — Headline, subheadline, CTA buttons, interactive orbit diagram of 5 modules
3. **Problem** — AI agent sprawl, fragmented observability, agent security risk, unpredictable AI cost
4. **Platform Modules** — Five module cards with features
5. **Pricing Calculator** — Interactive SaaS cost estimator with live breakdown
6. **Pricing Tiers** — Starter, Professional, Enterprise plan cards
7. **Competitor Comparison** — Table comparing AMS vs Datadog, Microsoft Agent 365, Zenity, ServiceNow AI Control Tower
8. **Deployment Options** — SaaS vs Self-hosted / Private deployment
9. **Final CTA** — Estimate Pricing, Request Demo

---

## How to Run Locally

Simply open `index.html` in a browser. No server required.

```bash
# Option 1: Open directly
open ams-landing/index.html

# Option 2: Serve locally with Python
cd ams-landing
python3 -m http.server 8080
# Visit http://localhost:8080

# Option 3: Serve with Node.js npx serve
cd ams-landing
npx serve .
```

---

## How to Host on GitHub Pages

### Option A — Repository root (quickest)

1. Copy `index.html`, `styles.css`, `script.js` to the repository root.
2. Go to **Settings → Pages**.
3. Under **Source**, select **Deploy from a branch**.
4. Choose `main` branch and `/ (root)` directory.
5. Save. GitHub Pages will be live at `https://<username>.github.io/<repo>/`.

### Option B — `/docs` folder

1. Move the three files into a `/docs` folder.
2. Go to **Settings → Pages**.
3. Under **Source**, select `main` branch and `/docs` directory.
4. Save.

### Option C — `gh-pages` branch

1. Create a `gh-pages` branch.
2. Place the three files in the root of that branch.
3. Go to **Settings → Pages** and select `gh-pages` as the source.

> **Note:** Google Fonts is loaded from `fonts.googleapis.com`. If offline or in restricted environments, the page falls back to system sans-serif fonts gracefully.

---

## Pricing Calculator

The calculator is fully client-side JavaScript with no backend.

### Main Inputs
| Input | Description |
|-------|-------------|
| AMS Users | Platform users with AMS access — $12/user/month |
| Active Agents | Unique agents managed — $20/agent/month |
| Monthly Sessions | First 100k included; $0.80 per additional 1,000 |
| Telemetry Volume | Command Center ingest — $0.12/GB/month |
| FortifyOps Scans | Per-scan pricing by depth (Basic / Standard / Deep) |
| Developers | Engineering observability — $8/developer/month |

### Advanced Settings
- **Deployment type:** SaaS (1.0×), Private SaaS (1.25×), Self-hosted (1.4×)
- **Retention:** 30 days (1.0×), 60 days (1.2×), 90 days (1.5×), 180 days (2.2×)
- **LLM intelligence:** Off ($0), Standard ($300), Advanced ($1,500), Premium ($4,000)
- **Scan depth:** Basic ($2), Standard ($8), Deep ($25)
- **Support tier:** Standard (1.0×), Premium (1.15×), Dedicated (1.3×)

### Calculator Output
- Recommended plan (Starter / Professional / Enterprise)
- Estimated monthly and annual cost
- Module-wise cost breakdown with visual bars
- Top 3 cost drivers
- Context-aware optimization suggestions

### Export
Click **Export Estimate** to download a `.txt` file with inputs, pricing result, and JSON breakdown.

---

## Base Plan Fees

| Plan | Base Fee | Best For |
|------|----------|---------|
| Starter | $2,500/month | Teams beginning AI agent governance |
| Professional | $7,500/month | Enterprise teams scaling AgentOps |
| Enterprise | $18,000/month | Large enterprise AI control plane |

---

## JavaScript Functions

The calculator implements the following clean functions in `script.js`:

| Function | Purpose |
|----------|---------|
| `getInputValues()` | Read and sanitize all calculator inputs |
| `recommendPlan(inputs)` | Determine Starter / Professional / Enterprise |
| `calculateBaseCost(plan)` | Return plan base fee |
| `calculateUserCost(users)` | $12 × users |
| `calculateAgentCost(agents)` | $20 × agents |
| `calculateSessionCost(sessions)` | Overage above 100k sessions |
| `calculateTelemetryCost(gb, retention)` | GB × $0.12 × retention multiplier |
| `calculateLLMIntelligenceCost(level)` | Fixed fee by intelligence level |
| `calculateFortifyOpsCost(scans, depth)` | Per-scan rate × scan count |
| `calculateEngineeringObservabilityCost(devs)` | $8 × developers |
| `applyDeploymentAndSupportMultiplier(...)` | Combined multiplier adjustment |
| `calculateTotal()` | Master function returning full result |
| `renderBreakdown()` | Render breakdown bars |
| `renderTopCostDrivers()` | Render top 3 cost drivers |
| `renderOptimizationSuggestions()` | Render optimization suggestions |
| `resetCalculator()` | Reset all inputs and clear results |
| `exportEstimate()` | Download estimate as .txt file |

---

## Design System

- **Background:** Dark navy `#060b18` with layered depth
- **Accents:** Electric blue `#3b82f6`, Cyan `#22d3ee`, Violet `#8b5cf6`, Green `#10b981`, Amber `#f59e0b`
- **Typography:** Inter (system fallback) + JetBrains Mono for data
- **Cards:** Glass-morphism with `backdrop-filter: blur` and subtle borders
- **Layout:** CSS Grid and Flexbox, fully responsive
- **Motion:** Intersection Observer-based reveals, counter animations, CSS transitions. Respects `prefers-reduced-motion`.

---

## Accessibility

- Semantic HTML (`<nav>`, `<main>`, `<section>`, `<article>`, `<footer>`)
- ARIA labels and roles on interactive elements
- `aria-live` region on calculator results
- Focus-visible keyboard navigation
- Accessible color contrast (WCAG AA target)
- Screen reader-friendly comparison table with `scope` attributes

---

## Pricing Disclaimer

> **All pricing figures in this calculator and on this page are illustrative estimates for planning and discussion purposes only. Final pricing is subject to contract terms, deployment model, data residency requirements, integration scope, support level, and volume commitments. Contact the AMS team for a formal quote.**

---

## Competitor Trademarks

All competitor names and trademarks (Datadog, Microsoft, Zenity, ServiceNow) belong to their respective owners. AMS is not affiliated with, endorsed by, or in partnership with any of these companies. Comparison information reflects publicly available positioning and is provided for general market context only.

---

## License

This landing page is provided as a reference implementation. All AMS product content, branding, and pricing are illustrative.
