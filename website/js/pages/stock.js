// The order API needs a country; the trading page also defaults to 1.
var ORDER_COUNTRY_ID = 1;

var CHART_RANGE_LABEL_STYLE = {
  "1d": "time", "5d": "day", "1m": "day", "3m": "day", "1y": "month", "5y": "year",
};


// Reads the first present value among several possible vendor field names.
class FieldReader {
  static pick(source, keys) {
    if (!source) {
      return null;
    }
    for (var i = 0; i < keys.length; i++) {
      var value = source[keys[i]];
      if (value && typeof value === "object" && "value" in value) {
        value = value.value;
      }
      if (value !== undefined && value !== null && value !== "") {
        return value;
      }
    }
    return null;
  }

  static number(source, keys) {
    var value = FieldReader.pick(source, keys);
    return value !== null && isFinite(Number(value)) ? Number(value) : null;
  }
}


// Number formatting that the shared MarketFormat helpers don't cover.
class StockFormat {
  static compact(value) {
    if (value === null || !isFinite(value)) {
      return "—";
    }
    var units = [[1e12, "T"], [1e9, "B"], [1e6, "M"], [1e3, "K"]];
    var unit = units.find(function (pair) { return Math.abs(value) >= pair[0]; });
    return unit ? (value / unit[0]).toFixed(2) + unit[1] : value.toFixed(2);
  }

  static percent(value) {
    if (value === null || !isFinite(value)) {
      return "—";
    }
    return (value >= 0 ? "+" : "") + value.toFixed(2) + "%";
  }

  static cssColor(variableName) {
    return getComputedStyle(document.documentElement).getPropertyValue(variableName).trim();
  }
}


// Loads and normalises price bars. "1d" uses the intraday minute feed; the daily
// history feed only accepts month/year ranges, so "5d" is the tail of "1m".
class PriceHistoryService {
  constructor(symbol) {
    this.symbol = symbol;
    this.requestsByRange = {};
  }

  // Caches the in-flight request so panels asking for the same range share one call.
  fetch(range) {
    if (range === "5d") {
      return this.fetch("1m").then(function (bars) { return bars.slice(-5); });
    }
    var self = this;
    if (!this.requestsByRange[range]) {
      this.requestsByRange[range] = this.request(range).then(function (response) {
        var bars = ResponseShape.findList(response.results).map(function (row) { return self.toBar(row, range); });
        return bars.filter(function (bar) { return bar.close !== null; });
      });
      this.requestsByRange[range].fail(function () { delete self.requestsByRange[range]; });
    }
    return this.requestsByRange[range];
  }

  request(range) {
    if (range === "1d") {
      return callBeyondlyApi("GET", "/marketdata/equity/intraday/", { query: { symbol: this.symbol } });
    }
    return callBeyondlyApi("GET", "/marketdata/equity/history/", { query: { symbol: this.symbol, range: range } });
  }

  // Intraday rows use open/close; daily history rows use opening/price.
  toBar(row, range) {
    return {
      label: PriceHistoryService.label(String(row.time || row.date || ""), CHART_RANGE_LABEL_STYLE[range]),
      open: FieldReader.number(row, ["open", "opening"]),
      high: FieldReader.number(row, ["high"]),
      low: FieldReader.number(row, ["low"]),
      close: FieldReader.number(row, ["close", "price"]),
    };
  }

  // Intraday rows look like "2026-08-13 04:01:00"; daily rows like "07/20/2026 00:00:00 EDT".
  static label(rawDate, style) {
    if (style === "time") {
      return rawDate.split(" ")[1] ? rawDate.split(" ")[1].slice(0, 5) : rawDate;
    }
    var dateParts = rawDate.split(" ")[0].split("/");
    var date = new Date(Number(dateParts[2]), Number(dateParts[0]) - 1, Number(dateParts[1]));
    if (isNaN(date.getTime())) {
      return rawDate;
    }
    var options = { day: { month: "short", day: "numeric" }, month: { month: "short", year: "2-digit" }, year: { year: "numeric" } };
    return date.toLocaleDateString("en-US", options[style]);
  }

  static extremes(bars) {
    var isPresent = function (value) { return value !== null; };
    var highs = bars.map(function (bar) { return bar.high; }).filter(isPresent);
    var lows = bars.map(function (bar) { return bar.low; }).filter(isPresent);
    return highs.length ? { low: Math.min.apply(null, lows), high: Math.max.apply(null, highs) } : null;
  }
}


// Purple header card: price, change, key stats, watchlist toggle and week/month returns.
class StockSummaryCard {
  constructor(symbol) {
    this.symbol = symbol;
    this.watchlist = StoredSymbolList.watchlist();
  }

  renderIdentity() {
    $("#stockAvatarSlot").html(MarketFormat.avatarHtml(this.symbol, "mkt-avatar-lg"));
    $("#stockSymbolLabel").text(this.symbol);
    $("#stockCompanyName").text(this.symbol);
    this.refreshWatchlistIcon();
  }

  // Swaps the letter avatar for the company logo, falling back if the image fails.
  renderLogo(logo) {
    var logoUrl = logo ? logo.logo_square || logo.logo_thumbnail : "";
    if (!/^https:\/\//i.test(logoUrl || "")) {
      return;
    }
    var fallbackHtml = $("#stockAvatarSlot").html();
    var $image = $("<img class='mkt-avatar mkt-avatar-lg stk-logo' alt=''>").attr("src", logoUrl);
    $image.on("error", function () { $("#stockAvatarSlot").html(fallbackHtml); });
    $("#stockAvatarSlot").empty().append($image);
  }

  renderQuote(quote) {
    $("#stockCompanyName").text(MarketFormat.displayName(quote));
    $("#stockPrice").text(MarketFormat.price(quote.lastPrice));
    $("#stockChange").html(MarketFormat.changeHtml(quote));
    document.title = quote.symbol + " " + MarketFormat.price(quote.lastPrice) + " | Beyondly";
  }

  renderStats(stats) {
    var rowsHtml = stats.map(function (stat) {
      return "<div class='stk-stat'><span>" + stat[0] + "</span><span>" + MarketFormat.escape(stat[1]) + "</span></div>";
    }).join("");
    $("#stockStatGrid").html(rowsHtml);
  }

  renderPeriodReturn(elementId, label, percent) {
    var isUp = percent === null || percent >= 0;
    var arrow = isUp ? "bi-arrow-up" : "bi-arrow-down";
    $("#" + elementId).html(
      "<span class='stk-period-icon " + (isUp ? "is-up" : "is-down") + "'><i class='bi " + arrow + "'></i></span>" +
      "<div><div class='small text-muted-custom'>" + label + "</div>" +
      "<div class='stk-period-value change-" + (isUp ? "up" : "down") + "'>" + StockFormat.percent(percent) + "</div></div>"
    );
  }

  refreshWatchlistIcon() {
    var isWatched = this.watchlist.has(this.symbol);
    $("#watchlistToggle i").attr("class", isWatched ? "bi bi-bookmark-check-fill" : "bi bi-bookmark");
  }

  bindWatchlistToggle() {
    var self = this;
    $("#watchlistToggle").on("click", function () {
      if (self.watchlist.has(self.symbol)) {
        self.watchlist.remove(self.symbol);
      } else {
        self.watchlist.addToFront(self.symbol);
      }
      self.refreshWatchlistIcon();
    });
  }
}


// Builds the "key stats" rows from the quote, today's bars and the company insights.
class KeyStatsBuilder {
  static build(quote, dayRange, insights) {
    var previousClose = FieldReader.number(quote, ["previousClose", "prevClose", "close"]);
    if (previousClose === null && isFinite(quote.lastPrice - quote.change)) {
      previousClose = quote.lastPrice - quote.change;
    }
    return [
      ["Open", MarketFormat.price(FieldReader.number(quote, ["open", "openPrice"]) ?? dayRange.open)],
      ["High", MarketFormat.price(FieldReader.number(quote, ["high", "dayHigh"]) ?? dayRange.high)],
      ["Low", MarketFormat.price(FieldReader.number(quote, ["low", "dayLow"]) ?? dayRange.low)],
      ["Prev. Close", MarketFormat.price(previousClose)],
      ["Volume", StockFormat.compact(FieldReader.number(quote, ["volume"]))],
      ["Market Cap", StockFormat.compact(KeyStatsBuilder.marketCap(insights))],
      ["Earnings", insights.earning_release ? EarningsPanel.formatDate(insights.earning_release.date, true) : "—"],
    ];
  }

  // Insights reports market cap in millions of dollars.
  static marketCap(insights) {
    var millions = FieldReader.number(insights, ["market_cap"]);
    return millions === null ? null : millions * 1e6;
  }

  static dayRange(intradayBars) {
    var extremes = PriceHistoryService.extremes(intradayBars) || {};
    var firstBar = intradayBars[0] || {};
    return { open: firstBar.open ?? null, high: extremes.high ?? null, low: extremes.low ?? null };
  }
}


// Shown in place of the 1D chart when the minute feed has no bars (before the
// open, weekends, holidays, or a provider gap): the latest completed session.
class LastSessionSummary {
  static heading() {
    return UsMarketSession.isRegularSessionOpen()
      ? "Market open · live intraday chart not available yet"
      : "Market closed";
  }

  static html(dailyBars) {
    var lastBar = dailyBars[dailyBars.length - 1];
    var headingHtml = "<div class='stk-session-heading'>" + MarketFormat.escape(LastSessionSummary.heading()) + "</div>";
    if (!lastBar) {
      return "<div class='stk-session'>" + headingHtml + "</div>";
    }
    return "<div class='stk-session'>" + headingHtml +
      "<div class='stk-session-date'>Last session · " + MarketFormat.escape(lastBar.label) + "</div>" +
      LastSessionSummary.closeHtml(lastBar, dailyBars[dailyBars.length - 2]) +
      "<div class='stk-session-stats'>" + LastSessionSummary.statsHtml(lastBar) + "</div></div>";
  }

  static closeHtml(lastBar, previousBar) {
    var closeHtml = "<span class='stk-session-close'>" + MarketFormat.price(lastBar.close) + "</span>";
    if (!previousBar || !previousBar.close) {
      return "<div>" + closeHtml + "</div>";
    }
    var change = lastBar.close - previousBar.close;
    var changeQuote = { change: change, changePercent: (change / previousBar.close) * 100 };
    return "<div>" + closeHtml + " " + MarketFormat.changeHtml(changeQuote) + "</div>";
  }

  static statsHtml(bar) {
    return [["Open", bar.open], ["High", bar.high], ["Low", bar.low], ["Close", bar.close]]
      .map(function (stat) {
        return "<div><span class='text-muted-custom'>" + stat[0] + "</span> " + MarketFormat.price(stat[1]) + "</div>";
      })
      .join("");
  }
}


// Area chart of closing prices for the selected range.
class PriceChart {
  constructor(historyService) {
    this.historyService = historyService;
    this.chart = null;
    this.activeRange = "1d";
  }

  bindRangeTabs() {
    var self = this;
    $("#chartRangeTabs").on("click", ".mkt-chip", function () {
      $("#chartRangeTabs .mkt-chip").removeClass("active");
      $(this).addClass("active");
      self.show($(this).data("range"));
    });
  }

  show(range) {
    var self = this;
    this.activeRange = range;
    this.showMessage("Loading chart…");
    this.historyService.fetch(range)
      .done(function (bars) {
        if (range === self.activeRange) {
          self.render(bars, range);
        }
      })
      .fail(function () { self.showMessage("Chart data unavailable right now."); });
  }

  showMessage(text) {
    $("#priceChartMessage").text(text).toggleClass("d-none", !text);
  }

  // An empty minute feed doesn't mean the market is closed, so 1D falls back to the last session.
  showLastSession() {
    var self = this;
    this.historyService.fetch("1m")
      .done(function (dailyBars) {
        if (self.activeRange === "1d") {
          $("#priceChartMessage").html(LastSessionSummary.html(dailyBars)).removeClass("d-none");
        }
      })
      .fail(function () {
        if (self.activeRange === "1d") self.showMessage(LastSessionSummary.heading());
      });
  }

  clearChart() {
    if (this.chart) {
      this.chart.destroy();
      this.chart = null;
    }
  }

  // Colours are read from the theme when a chart is built, so rebuild on theme change.
  redrawForTheme() {
    if (this.chart && this.lastBars) this.render(this.lastBars, this.lastRange);
  }

  render(bars, range) {
    this.lastBars = bars;
    this.lastRange = range;
    if (!bars.length) {
      this.clearChart();
      if (range === "1d") this.showLastSession();
      else this.showMessage("No price data for this range yet.");
      return;
    }
    this.showMessage("");
    var isUp = bars[bars.length - 1].close >= bars[0].close;
    var lineColor = StockFormat.cssColor(isUp ? "--color-buy" : "--color-sell");
    if (this.chart) {
      this.chart.destroy();
    }
    this.chart = new Chart(document.getElementById("priceChart"), this.config(bars, lineColor));
  }

  config(bars, lineColor) {
    return {
      type: "line",
      data: {
        labels: bars.map(function (bar) { return bar.label; }),
        datasets: [{
          data: bars.map(function (bar) { return bar.close; }),
          borderColor: lineColor, borderWidth: 1.6, pointRadius: 0, tension: 0.15,
          fill: true, backgroundColor: PriceChart.fillGradient(lineColor),
        }],
      },
      options: PriceChart.options(),
    };
  }

  static fillGradient(lineColor) {
    return function (context) {
      var area = context.chart.chartArea;
      if (!area) {
        return "transparent";
      }
      var gradient = context.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
      gradient.addColorStop(0, lineColor + "55");
      gradient.addColorStop(1, lineColor + "00");
      return gradient;
    };
  }

  static options() {
    var gridColor = StockFormat.cssColor("--chart-grid");
    var tickColor = StockFormat.cssColor("--color-text-muted");
    return {
      responsive: true, maintainAspectRatio: false,
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: false }, tooltip: { displayColors: false, callbacks: { label: function (item) { return MarketFormat.price(item.parsed.y); } } } },
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor, maxTicksLimit: 6, maxRotation: 0 } },
        y: { position: "right", grid: { color: gridColor }, ticks: { color: tickColor, maxTicksLimit: 6 } },
      },
    };
  }
}


// Low/high band for today, the last month or 52 weeks, with the current price marked.
class PerformanceRangePanel {
  static PERIODS = {
    day: { range: "1d", lowLabel: "Today's Low", highLabel: "Today's High" },
    month: { range: "1m", lowLabel: "1M Low", highLabel: "1M High" },
    year: { range: "1y", lowLabel: "52W Low", highLabel: "52W High" },
  };

  constructor(historyService) {
    this.historyService = historyService;
    this.currentPrice = null;
    this.quoteDayRange = null;
  }

  // Today's low/high from the quote, used when the minute feed is empty.
  setQuote(quote) {
    var low = FieldReader.number(quote, ["dayLow", "low"]);
    var high = FieldReader.number(quote, ["dayHigh", "high"]);
    this.currentPrice = Number(quote.lastPrice);
    this.quoteDayRange = low !== null && high !== null ? { low: low, high: high } : null;
  }

  bindTabs() {
    var self = this;
    $("#performanceTabs").on("click", ".mkt-chip", function () {
      $("#performanceTabs .mkt-chip").removeClass("active");
      $(this).addClass("active");
      self.show($(this).data("period"));
    });
  }

  show(periodKey) {
    var period = PerformanceRangePanel.PERIODS[periodKey];
    var self = this;
    $("#rangeLowLabel").text(period.lowLabel);
    $("#rangeHighLabel").text(period.highLabel);
    this.historyService.fetch(period.range).done(function (bars) {
      var fallback = period.range === "1d" ? self.quoteDayRange : null;
      self.render(PriceHistoryService.extremes(bars) || fallback);
    });
  }

  render(extremes) {
    $("#rangeLowValue").text(extremes ? extremes.low.toFixed(2) : "—");
    $("#rangeHighValue").text(extremes ? extremes.high.toFixed(2) : "—");
    var spread = extremes ? extremes.high - extremes.low : 0;
    var position = spread > 0 && isFinite(this.currentPrice) ? (this.currentPrice - extremes.low) / spread : 0.5;
    $("#rangeMarker").css("left", Math.min(Math.max(position, 0), 1) * 100 + "%");
  }
}


// Company facts and description from the equity insights endpoint.
class CompanyOverviewPanel {
  static FACTS = [
    ["Sector", "sector.sector"],
    ["Industry Group", "sector.industry_group"],
    ["Industry", "sector.industry"],
    ["Sub-industry", "sector.sub_industry"],
    ["Exchange", "exchange_name"],
    ["Phone", "phone"],
  ];

  render(insights) {
    var factRows = CompanyOverviewPanel.FACTS
      .map(function (fact) { return [fact[0], CompanyOverviewPanel.read(insights, fact[1])]; })
      .concat([["Employees", CompanyOverviewPanel.employees(insights)], ["Headquarters", CompanyOverviewPanel.headquarters(insights)]])
      .filter(function (fact) { return fact[1]; });
    var factsHtml = factRows.map(CompanyOverviewPanel.factHtml).join("") + CompanyOverviewPanel.websiteHtml(insights.website);
    $("#companyFacts").html(factsHtml || QuoteMarkup.message("No company facts available."));
    $("#companyTagline").text(insights.short_description || "");
    $("#companyDescription").text(insights.long_description || "No company description available.");
  }

  // Reads dotted paths such as "sector.industry".
  static read(insights, path) {
    var value = path.split(".").reduce(function (node, key) { return node ? node[key] : null; }, insights);
    return value === undefined || value === null || typeof value === "object" ? null : value;
  }

  static employees(insights) {
    var count = Number(insights.employees_number);
    return count > 0 ? count.toLocaleString("en-US") : null;
  }

  static headquarters(insights) {
    var parts = [insights.address, insights.city, insights.province, insights.country];
    return parts.filter(function (part) { return part; }).join(", ") || null;
  }

  static websiteHtml(website) {
    if (!/^https?:\/\//i.test(website || "")) {
      return "";
    }
    var safeUrl = MarketFormat.escape(website);
    return "<div class='stk-fact'><span>Website</span><span><a href='" + safeUrl + "' target='_blank' rel='noopener'>" + safeUrl + "</a></span></div>";
  }

  static factHtml(fact) {
    return "<div class='stk-fact'><span>" + fact[0] + "</span><span>" + MarketFormat.escape(fact[1]) + "</span></div>";
  }

  showUnavailable() {
    $("#companyFacts, #ownershipPattern, #earningsRelease").html(QuoteMarkup.message("Company insights unavailable right now."));
  }
}


// Insider / institutional / fund ownership percentages as horizontal bars.
class OwnershipPanel {
  static HOLDERS = [
    ["Insider", "insider_ownership_percent"],
    ["Institutional", "institutional_ownership_percent"],
    ["Fund", "fund_ownership_percent"],
  ];

  render(insights) {
    var rowsHtml = OwnershipPanel.HOLDERS
      .map(function (holder) { return [holder[0], FieldReader.number(insights, [holder[1]])]; })
      .filter(function (holder) { return holder[1] !== null; })
      .map(OwnershipPanel.rowHtml)
      .join("");
    $("#ownershipPattern").html(rowsHtml || QuoteMarkup.message("No ownership data available."));
  }

  static rowHtml(holder) {
    var width = Math.min(Math.max(holder[1], 0), 100);
    return (
      "<div class='stk-ownership-row'><span>" + holder[0] + "</span>" +
      "<span class='stk-ownership-track'><span class='stk-ownership-fill' style='width:" + width + "%'></span></span>" +
      "<span class='fw-semibold text-end'>" + holder[1].toFixed(2) + "%</span></div>"
    );
  }
}


// Upcoming earnings release (date, session timing, quarter and confirmation status).
class EarningsPanel {
  render(insights) {
    var release = insights.earning_release;
    if (!release || !release.date) {
      $("#earningsRelease").html(QuoteMarkup.message("No upcoming earnings date announced."));
      return;
    }
    var rows = [["Quarter", release.quarter], ["Timing", release.time], ["Status", release.status]]
      .filter(function (row) { return row[1]; });
    $("#earningsRelease").html(
      "<div class='stk-earnings-date mb-2'>" + MarketFormat.escape(EarningsPanel.formatDate(release.date)) + "</div>" +
      rows.map(CompanyOverviewPanel.factHtml).join("")
    );
  }

  // Dates arrive as "10/30/2026 00:00:00".
  static formatDate(rawDate, isShort) {
    var parts = String(rawDate).split(" ")[0].split("/");
    var date = new Date(Number(parts[2]), Number(parts[0]) - 1, Number(parts[1]));
    var options = isShort ? { month: "short", day: "numeric" } : { month: "short", day: "numeric", year: "numeric" };
    return isNaN(date.getTime()) ? rawDate : date.toLocaleDateString("en-US", options);
  }
}


// Turns vendor income statements into chronological periods with the metrics we chart.
class IncomeStatementReader {
  static METRICS = [
    ["Revenue", ["revenues", "revenue", "total_revenue", "totalRevenue"]],
    ["Gross Profit", ["gross_profit", "grossProfit"]],
    ["Operating Income", ["operating_income", "operating_income_loss", "operatingIncome"]],
    ["Net Income", ["net_income", "net_income_loss", "netIncome"]],
  ];

  static read(response, periodCount) {
    return IncomeStatementReader.statementList(response)
      .map(IncomeStatementReader.flatten)
      .map(IncomeStatementReader.toPeriod)
      .filter(function (period) { return period.values.some(function (value) { return value !== null; }); })
      .sort(function (a, b) { return a.sortKey < b.sortKey ? -1 : 1; })
      .slice(-periodCount);
  }

  // The market-data API keys statements by period ({"2025Q4": {...}, "currency": "USD"});
  // older payloads were a plain income_statements list.
  static statementList(response) {
    var statementsByPeriod = response.income_statement;
    if (!statementsByPeriod || Array.isArray(statementsByPeriod)) {
      return response.income_statements || ResponseShape.findList(response);
    }
    return Object.keys(statementsByPeriod)
      .filter(function (periodKey) { return /^\d{4}(Q\d)?$/.test(periodKey); })
      .map(function (periodKey) { return IncomeStatementReader.fromPeriodKey(periodKey, statementsByPeriod[periodKey]); });
  }

  // "2025Q4" becomes Q4 2025; a bare "2022" is a full fiscal year.
  static fromPeriodKey(periodKey, statement) {
    return Object.assign({}, statement, {
      fiscal_year: periodKey.slice(0, 4),
      fiscal_period: periodKey.slice(4) || "FY",
      period_end: periodKey,
    });
  }

  // Some vendors nest line items under financials.income_statement.
  static flatten(statement) {
    var nested = statement.financials && statement.financials.income_statement;
    return Object.assign({}, statement, nested || {});
  }

  static toPeriod(statement) {
    var fiscalPeriod = FieldReader.pick(statement, ["fiscal_period", "period", "fiscalPeriod"]) || "";
    var fiscalYear = FieldReader.pick(statement, ["fiscal_year", "year", "fiscalYear"]) || "";
    var filingDate = FieldReader.pick(statement, ["filing_date", "filingDate", "end_date", "date"]) || "";
    return {
      label: (fiscalPeriod + " " + fiscalYear).trim() || filingDate,
      sortKey: String(FieldReader.pick(statement, ["end_date", "period_end", "filing_date", "date"]) || fiscalYear + fiscalPeriod),
      filingDate: filingDate,
      values: IncomeStatementReader.METRICS.map(function (metric) { return FieldReader.number(statement, metric[1]); }),
    };
  }
}


// Financials tab: quarterly/annual toggle, revenue vs net income chart and metric table.
class FinancialsPanel {
  constructor(symbol) {
    this.symbol = symbol;
    this.periodsByMode = {};
    this.activeMode = "quarterly";
    this.chart = null;
  }

  bindModeTabs() {
    var self = this;
    $("#fundamentalsModeTabs").on("click", ".seg-btn", function () {
      $("#fundamentalsModeTabs .seg-btn").removeClass("active");
      $(this).addClass("active");
      self.show($(this).data("mode"));
    });
  }

  show(mode) {
    this.activeMode = mode;
    if (this.periodsByMode[mode]) {
      this.render(this.periodsByMode[mode]);
      return;
    }
    this.showMessage("Loading financials…");
    this.fetch(mode);
  }

  fetch(mode) {
    var self = this;
    callBeyondlyApi("GET", "/marketdata/symbol/fundamentals/", { query: { symbol: this.symbol, mode: mode } })
      .done(function (response) {
        self.periodsByMode[mode] = IncomeStatementReader.read(response, 5);
        if (mode === self.activeMode) {
          self.render(self.periodsByMode[mode]);
        }
      })
      .fail(function (jqXHR) { self.showMessage(extractApiErrorMessage(jqXHR)); });
  }

  showMessage(text) {
    $("#incomeMessage").text(text).toggleClass("d-none", !text);
    $("#incomeTable").toggleClass("d-none", !!text);
    $("#incomeChart").parent().toggleClass("d-none", !!text);
  }

  render(periods) {
    if (!periods.length) {
      this.showMessage("No income statement data for this company.");
      return;
    }
    this.showMessage("");
    $("#incomeTable").html(FinancialsPanel.tableHtml(periods));
    this.renderChart(periods);
  }

  static tableHtml(periods) {
    var headerHtml = "<thead><tr><th>Metric</th>" + periods.map(function (period) {
      return "<th>" + MarketFormat.escape(period.label) + "</th>";
    }).join("") + "</tr></thead>";
    var metricRows = IncomeStatementReader.METRICS.map(function (metric, index) {
      return "<tr><td>" + metric[0] + "</td>" + periods.map(function (period) {
        return "<td>" + StockFormat.compact(period.values[index]) + "</td>";
      }).join("") + "</tr>";
    });
    return headerHtml + "<tbody>" + metricRows.join("") + FinancialsPanel.filingRowHtml(periods) + "</tbody>";
  }

  // The market-data API has no filing dates, so the row only shows when some period has one.
  static filingRowHtml(periods) {
    if (!periods.some(function (period) { return period.filingDate; })) {
      return "";
    }
    return "<tr><td>Filing Date</td>" + periods.map(function (period) {
      return "<td>" + MarketFormat.escape(period.filingDate || "—") + "</td>";
    }).join("") + "</tr>";
  }

  redrawForTheme() {
    if (this.chart && this.lastPeriods) this.renderChart(this.lastPeriods);
  }

  renderChart(periods) {
    this.lastPeriods = periods;
    if (this.chart) {
      this.chart.destroy();
    }
    this.chart = new Chart(document.getElementById("incomeChart"), {
      data: {
        labels: periods.map(function (period) { return period.label; }),
        datasets: FinancialsPanel.datasets(periods),
      },
      options: FinancialsPanel.chartOptions(),
    });
  }

  static datasets(periods) {
    var valuesAt = function (index) { return periods.map(function (period) { return period.values[index]; }); };
    var primary = StockFormat.cssColor("--color-primary");
    var gold = StockFormat.cssColor("--chart-gold");
    var green = StockFormat.cssColor("--color-buy");
    return [
      { type: "bar", label: "Revenue", data: valuesAt(0), backgroundColor: primary, borderRadius: 4 },
      { type: "bar", label: "Net Income", data: valuesAt(3), backgroundColor: gold, borderRadius: 4 },
      { type: "line", label: "Gross Profit", data: valuesAt(1), borderColor: green, backgroundColor: green, tension: 0.3 },
    ];
  }

  static chartOptions() {
    var tickColor = StockFormat.cssColor("--color-text-muted");
    return {
      responsive: true, maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: tickColor, boxWidth: 10 } },
        tooltip: { callbacks: { label: function (item) { return item.dataset.label + ": " + StockFormat.compact(item.parsed.y); } } },
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: tickColor } },
        y: { grid: { color: StockFormat.cssColor("--chart-grid") }, ticks: { color: tickColor, callback: StockFormat.compact } },
      },
    };
  }
}


// Standard indicator maths over a list of daily closes (oldest first).
class TechnicalIndicators {
  constructor(closes) {
    this.closes = closes;
  }

  sma(period) {
    if (this.closes.length < period) {
      return null;
    }
    var window = this.closes.slice(-period);
    return window.reduce(function (sum, value) { return sum + value; }, 0) / period;
  }

  static emaSeries(values, period) {
    var multiplier = 2 / (period + 1);
    var series = [values[0]];
    for (var i = 1; i < values.length; i++) {
      series.push((values[i] - series[i - 1]) * multiplier + series[i - 1]);
    }
    return series;
  }

  ema(period) {
    if (this.closes.length < period) {
      return null;
    }
    var series = TechnicalIndicators.emaSeries(this.closes, period);
    return series[series.length - 1];
  }

  // Wilder's RSI: seed with simple averages, then smooth each later change.
  rsi(period) {
    if (this.closes.length <= period) {
      return null;
    }
    var changes = this.closes.slice(1).map(function (close, index) { return close - this.closes[index]; }, this);
    var averageGain = changes.slice(0, period).reduce(function (sum, c) { return sum + Math.max(c, 0); }, 0) / period;
    var averageLoss = changes.slice(0, period).reduce(function (sum, c) { return sum + Math.max(-c, 0); }, 0) / period;
    changes.slice(period).forEach(function (change) {
      averageGain = (averageGain * (period - 1) + Math.max(change, 0)) / period;
      averageLoss = (averageLoss * (period - 1) + Math.max(-change, 0)) / period;
    });
    return averageLoss === 0 ? 100 : 100 - 100 / (1 + averageGain / averageLoss);
  }

  macd() {
    if (this.closes.length < 35) {
      return null;
    }
    var fast = TechnicalIndicators.emaSeries(this.closes, 12);
    var slow = TechnicalIndicators.emaSeries(this.closes, 26);
    var macdLine = fast.map(function (value, index) { return value - slow[index]; });
    var signalLine = TechnicalIndicators.emaSeries(macdLine.slice(25), 9);
    var macdValue = macdLine[macdLine.length - 1];
    var signalValue = signalLine[signalLine.length - 1];
    return { macd: macdValue, signal: signalValue, histogram: macdValue - signalValue };
  }
}


// Technicals tab: oscillators and moving averages with a simple bullish/bearish read.
class TechnicalsPanel {
  render(closes, currentPrice) {
    var indicators = new TechnicalIndicators(closes);
    var price = isFinite(currentPrice) ? currentPrice : closes[closes.length - 1];
    $("#technicalIndicators").html(this.oscillatorRows(indicators).join(""));
    $("#movingAverages").html(this.movingAverageRows(indicators, price).join(""));
  }

  oscillatorRows(indicators) {
    var rsi = indicators.rsi(14);
    var macd = indicators.macd() || {};
    var rsiSignal = rsi === null ? null : rsi < 30 ? ["Oversold", "bullish"] : rsi > 70 ? ["Overbought", "bearish"] : ["Neutral", "neutral"];
    var macdSignal = macd.macd === undefined ? null : macd.macd > macd.signal ? ["Bullish", "bullish"] : ["Bearish", "bearish"];
    return [
      TechnicalsPanel.rowHtml("RSI (14)", rsi, rsiSignal),
      TechnicalsPanel.rowHtml("MACD (12, 26)", macd.macd, macdSignal),
      TechnicalsPanel.rowHtml("MACD Signal (9)", macd.signal, null),
      TechnicalsPanel.rowHtml("MACD Histogram", macd.histogram, null),
    ];
  }

  movingAverageRows(indicators, price) {
    var averages = [
      ["SMA (20 days)", indicators.sma(20)], ["EMA (20 days)", indicators.ema(20)],
      ["SMA (50 days)", indicators.sma(50)], ["SMA (200 days)", indicators.sma(200)],
    ];
    return averages.map(function (average) {
      var signal = average[1] === null ? null : price >= average[1] ? ["Buy", "bullish"] : ["Sell", "bearish"];
      return TechnicalsPanel.rowHtml(average[0], average[1], signal, "$");
    });
  }

  static rowHtml(label, value, signal, prefix) {
    var valueText = value === null || value === undefined ? "—" : (prefix || "") + value.toFixed(2);
    var badgeHtml = signal ? "<span class='stk-badge is-" + signal[1] + "'>" + signal[0].toUpperCase() + "</span>" : "<span class='stk-badge'></span>";
    return (
      "<div class='stk-indicator-row'><span>" + label + "</span>" +
      "<span class='fw-semibold'>" + valueText + "</span>" + badgeHtml + "</div>"
    );
  }

  showUnavailable() {
    $("#technicalIndicators, #movingAverages").html(QuoteMarkup.message("Not enough price history to calculate."));
  }
}


// Reads the order ticket into a validated request body for /trading/orders/place/.
class OrderTicketForm {
  constructor(symbol) {
    this.symbol = symbol;
    this.side = "buy";
    this.sizing = "shares";
    this.buyingPower = null;
    this.lastPrice = null;
  }

  category() {
    return this.sizing === "amount" ? "fractional" : $("#orderCategory").val();
  }

  needsLimitPrice() {
    return ["limit", "stop_limit"].indexOf(this.category()) !== -1;
  }

  needsStopPrice() {
    return ["stop", "stop_limit"].indexOf(this.category()) !== -1;
  }

  validationError() {
    var quantity = parseFloat($("#orderQuantity").val());
    if (!(quantity > 0)) {
      return this.sizing === "amount" ? "Enter an amount greater than zero." : "Enter a quantity greater than zero.";
    }
    if (this.sizing === "shares" && !Number.isInteger(quantity)) {
      return "Quantity must be a whole number of shares.";
    }
    if (this.needsLimitPrice() && !(parseFloat($("#orderLimitPrice").val()) > 0)) {
      return "Enter a limit price.";
    }
    if (this.needsStopPrice() && !(parseFloat($("#orderStopPrice").val()) > 0)) {
      return "Enter a stop price.";
    }
    return "";
  }

  // For "By Amount" the backend sends a notional order, so quantity carries the dollar amount.
  requestBody() {
    var body = {
      symbol: this.symbol, order_type: this.side, order_category: this.category(),
      exchange_name: $("#orderExchange").val(), country_id: ORDER_COUNTRY_ID,
      quantity: parseFloat($("#orderQuantity").val()), validity: $("#orderValidity").val(),
    };
    if (this.needsLimitPrice()) {
      body.limit_price = parseFloat($("#orderLimitPrice").val());
    }
    if (this.needsStopPrice()) {
      body.stop_price = parseFloat($("#orderStopPrice").val());
    }
    return body;
  }

  estimatedTotal() {
    var quantity = parseFloat($("#orderQuantity").val()) || 0;
    if (this.sizing === "amount") {
      return quantity;
    }
    var price = this.needsLimitPrice() ? parseFloat($("#orderLimitPrice").val()) : this.lastPrice;
    return price > 0 ? quantity * price : null;
  }
}


// Order ticket UI: side/sizing toggles, live estimate, preview modal and submission.
class OrderTicket {
  constructor(symbol) {
    this.form = new OrderTicketForm(symbol);
    this.confirmModal = new bootstrap.Modal(document.getElementById("orderConfirmModal"));
  }

  setQuote(quote) {
    this.form.lastPrice = Number(quote.lastPrice) || null;
    var exchangeCode = String(quote.primaryExchange || "").toUpperCase();
    $("#orderExchange").val(exchangeCode.indexOf("NYS") !== -1 ? "nyse" : "nasdaq");
    this.refresh();
  }

  bind() {
    var self = this;
    $("#orderSizingTabs").on("click", ".seg-btn", function () { self.selectSizing($(this).data("sizing")); });
    $("#orderForm").on("input change", function () { self.refresh(); });
    $("#orderQuantity").on("keydown", function (event) {
      var isDecimalKey = [".", ",", "e", "E"].indexOf(event.key) !== -1;
      if (self.form.sizing === "shares" && isDecimalKey) { event.preventDefault(); }
    });
    $("#orderForm").on("submit", function (event) {
      event.preventDefault();
      self.preview();
    });
    $("#placeOrderButton").on("click", function () { self.submit(); });
  }

  loadBuyingPower() {
    var self = this;
    callBeyondlyApi("GET", "/wallet/balance/").done(function (response) {
      var buyingPower = Number((response.balance || {}).availableCash);
      self.form.buyingPower = isFinite(buyingPower) ? buyingPower : null;
      $("#orderBuyingPower").text(self.form.buyingPower === null ? "—" : MarketFormat.price(self.form.buyingPower));
    });
  }

  // "By Amount" is a fractional (notional) market order: just an amount and a Day validity.
  selectSizing(sizing) {
    var isAmount = sizing === "amount";
    this.form.sizing = sizing;
    $("#orderSizingTabs .seg-btn").removeClass("active").filter("[data-sizing='" + sizing + "']").addClass("active");
    $("#orderQuantityLabel").text(isAmount ? "Amount" : "Quantity");
    $("#orderQuantityWrap").toggleClass("has-prefix", isAmount);
    $("#orderQuantity").val(isAmount ? "" : "1").attr({placeholder: isAmount ? "Enter value" : "", step: isAmount ? "any" : "1", min: isAmount ? "0" : "1"});
    $("#orderCategoryGroup, #orderExchangeGroup, #orderEstimateRow").toggleClass("d-none", isAmount);
    $("#orderValidity option[value='GTC']").prop("disabled", isAmount);
    if (isAmount) {
      $("#orderCategory").val("market_price");
      $("#orderValidity").val("DAY");
    }
    this.refresh();
  }

  refresh() {
    $("#limitPriceGroup").toggleClass("d-none", !this.form.needsLimitPrice());
    $("#stopPriceGroup").toggleClass("d-none", !this.form.needsStopPrice());
    var total = this.form.estimatedTotal();
    $("#orderEstimate").text(total === null ? "—" : MarketFormat.price(total));
    $("#orderFormError").text("");
  }

  preview() {
    var error = this.form.validationError();
    $("#orderFormError").text(error);
    if (error) {
      return;
    }
    var body = this.form.requestBody();
    $("#orderConfirmTitle").text("Confirm " + body.order_type + " order");
    $("#orderConfirmRows").html(this.summaryRows(body).map(CompanyOverviewPanel.factHtml).join(""));
    $("#orderConfirmError").addClass("d-none");
    this.confirmModal.show();
  }

  summaryRows(body) {
    var categoryLabels = { market_price: "Market", limit: "Limit", stop: "Stop", stop_limit: "Stop Limit", fractional: "Market (by amount)" };
    var rows = [
      ["Symbol", body.symbol], ["Order type", categoryLabels[body.order_category]],
      [this.form.sizing === "amount" ? "Amount" : "Quantity", this.form.sizing === "amount" ? MarketFormat.price(body.quantity) : body.quantity],
      ["Validity", body.validity === "GTC" ? "Good till cancelled" : "Day"], ["Exchange", body.exchange_name.toUpperCase()],
    ];
    if (body.limit_price) { rows.push(["Limit price", MarketFormat.price(body.limit_price)]); }
    if (body.stop_price) { rows.push(["Stop price", MarketFormat.price(body.stop_price)]); }
    rows.push(this.estimateRow(body));
    return rows;
  }

  estimateRow(body) {
    if (this.form.sizing !== "amount") {
      return ["Estimated cost", $("#orderEstimate").text()];
    }
    var approxShares = this.form.lastPrice ? (body.quantity / this.form.lastPrice).toFixed(4) : "—";
    return ["Approx. shares", approxShares];
  }

  submit() {
    var self = this;
    $("#placeOrderButton").prop("disabled", true).text("Placing…");
    callBeyondlyApi("POST", "/trading/orders/place/", { body: this.form.requestBody() })
      .done(function () {
        self.confirmModal.hide();
        $("#orderSuccessAlert").removeClass("d-none");
      })
      .fail(function (jqXHR) {
        $("#orderConfirmError").text(extractApiErrorMessage(jqXHR)).removeClass("d-none");
      })
      .always(function () { $("#placeOrderButton").prop("disabled", false).text("Place Order"); });
  }
}


// Wires the stock page together for the ?symbol= in the URL.
class StockPage {
  constructor(symbol) {
    this.symbol = symbol;
    this.history = new PriceHistoryService(symbol);
    this.ticker = new EtfTickerStrip(new QuoteService());
    this.summary = new StockSummaryCard(symbol);
    this.priceChart = new PriceChart(this.history);
    this.performance = new PerformanceRangePanel(this.history);
    this.overview = new CompanyOverviewPanel();
    this.ownership = new OwnershipPanel();
    this.earnings = new EarningsPanel();
    this.financials = new FinancialsPanel(symbol);
    this.technicals = new TechnicalsPanel();
    this.orderTicket = new OrderTicket(symbol);
    this.quote = null;
  }

  static symbolFromUrl() {
    return String(new URLSearchParams(window.location.search).get("symbol") || "").trim().toUpperCase();
  }

  static showError(message) {
    $("#stockErrorAlert").text(message).removeClass("d-none");
  }

  bindEvents() {
    this.summary.bindWatchlistToggle();
    this.priceChart.bindRangeTabs();
    this.performance.bindTabs();
    this.financials.bindModeTabs();
    this.orderTicket.bind();
    this.orderTicket.loadBuyingPower();
    this.bindPaneTabs();
    document.addEventListener("beyondly:themechange", () => {
      this.priceChart.redrawForTheme();
      this.financials.redrawForTheme();
    });
  }

  bindPaneTabs() {
    var self = this;
    $("#stockTabs").on("click", "button", function () {
      var pane = $(this).data("pane");
      $("#stockTabs button").removeClass("active");
      $(this).addClass("active");
      $(".stk-pane").addClass("d-none");
      $("#pane-" + pane).removeClass("d-none");
      if (pane === "financials" && !self.financials.periodsByMode.quarterly) {
        self.financials.show("quarterly");
      }
    });
  }

  loadData() {
    StoredSymbolList.recentlyViewed().addToFront(this.symbol);
    this.summary.renderIdentity();
    this.ticker.load();
    this.priceChart.show("1d");
    this.loadQuoteAndInsights();
    this.loadYearHistory();
  }

  loadQuoteAndInsights() {
    var self = this;
    var quoteRequest = new QuoteService().fetchQuotes([this.symbol]);
    var insightsRequest = callBeyondlyApi("GET", "/marketdata/equity/insights/", { query: { symbol: this.symbol } });
    var intradayRequest = this.history.fetch("1d");
    quoteRequest.fail(function (jqXHR) { StockPage.showError(extractApiErrorMessage(jqXHR)); });
    insightsRequest.done(function (insights) { self.renderInsights(insights); });
    insightsRequest.fail(function () { self.overview.showUnavailable(); });
    $.when(quoteRequest, StockPage.settled(insightsRequest), StockPage.settled(intradayRequest))
      .done(function (quotes, insights, intradayBars) { self.onQuoteLoaded(quotes[0], insights || {}, intradayBars || []); });
  }

  // Resolves with the value, or null on failure, so one missing feed doesn't block the rest.
  static settled(request) {
    return request.then(
      function (value) { return value; },
      function () { return $.Deferred().resolve(null).promise(); }
    );
  }

  renderInsights(insights) {
    this.overview.render(insights);
    this.ownership.render(insights);
    this.earnings.render(insights);
    this.summary.renderLogo(insights.logo);
  }

  onQuoteLoaded(quote, insights, intradayBars) {
    if (!quote) {
      StockPage.showError("No quote found for " + this.symbol + ".");
      return;
    }
    this.quote = quote;
    this.summary.renderQuote(quote);
    this.summary.renderStats(KeyStatsBuilder.build(quote, KeyStatsBuilder.dayRange(intradayBars), insights));
    this.orderTicket.setQuote(quote);
    this.performance.setQuote(quote);
    this.performance.show("day");
    this.startLivePrice();
  }

  // Streams this stock's price into the header, order estimate and range
  // marker; the board also keeps the ETF ticker strip live.
  startLivePrice() {
    var self = this;
    new LiveQuoteBoard([this.symbol], function (liveQuote) {
      if (liveQuote.symbol === self.symbol) {
        self.onLivePrice(liveQuote);
      }
    }).start();
  }

  onLivePrice(liveQuote) {
    this.quote = Object.assign({}, this.quote, liveQuote);
    this.summary.renderQuote(this.quote);
    this.orderTicket.form.lastPrice = this.quote.lastPrice;
    this.orderTicket.refresh();
    this.performance.currentPrice = this.quote.lastPrice;
  }

  loadYearHistory() {
    var self = this;
    this.history.fetch("1y")
      .done(function (bars) { self.onYearHistoryLoaded(bars.map(function (bar) { return bar.close; })); })
      .fail(function () { self.technicals.showUnavailable(); });
  }

  onYearHistoryLoaded(closes) {
    var latest = closes[closes.length - 1];
    var returnSince = function (tradingDays) {
      var base = closes[closes.length - 1 - tradingDays];
      return base ? (latest - base) / base * 100 : null;
    };
    this.summary.renderPeriodReturn("weekReturn", "Week", returnSince(5));
    this.summary.renderPeriodReturn("monthReturn", "Month", returnSince(21));
    if (closes.length < 30) {
      this.technicals.showUnavailable();
      return;
    }
    this.technicals.render(closes, this.performance.currentPrice);
  }
}


$(function () {
  if (!requireSignedInUser()) {
    return;
  }

  var symbol = StockPage.symbolFromUrl();
  if (!symbol) {
    StockPage.showError("No stock selected. Pick one from the Markets page.");
    $("#stockContent").addClass("d-none");
    return;
  }

  var page = new StockPage(symbol);
  page.bindEvents();
  page.loadData();
});
