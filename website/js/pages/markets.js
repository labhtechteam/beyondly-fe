// Curated symbol lists. The market-data API has no "movers" or "trending"
// endpoint, so those panels rank quotes for this universe on the client.
var MARKET_SYMBOLS = {
  popular: ["NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA"],
  universe: [
    "NVDA", "AAPL", "MSFT", "AMZN", "GOOGL", "META", "TSLA", "AMD", "NFLX", "INTC",
    "JPM", "V", "WMT", "DIS", "BA", "PLTR", "UBER", "COIN", "ORCL", "CRM", "SOFI", "NOK",
  ],
  etfs: {
    leaders: ["VOO", "SPY", "IVV", "VTI", "QQQ", "VEA"],
    popular: ["SCHD", "VUG", "VGT", "ARKK", "JEPI", "VYM"],
    emerging: ["VWO", "IEMG", "EEM", "INDA", "MCHI", "EWZ"],
    commodity: ["GLD", "SLV", "IAU", "USO", "DBC", "UNG"],
  },
};

// Builds the reusable HTML fragments every panel renders quotes with.
class QuoteMarkup {
  static row(quote, trailingHtml) {
    var symbol = MarketFormat.escape(quote.symbol);
    return (
      "<div class='mkt-row' data-open-symbol='" + symbol + "'>" +
        MarketFormat.avatarHtml(quote.symbol) +
        "<div class='mkt-row-main'>" +
          "<div class='mkt-name'>" + MarketFormat.escape(MarketFormat.displayName(quote)) + "</div>" +
          "<div class='mkt-symbol'>" + symbol + "</div>" +
        "</div>" +
        "<div class='text-end'><div class='mkt-price'>" + MarketFormat.price(quote.lastPrice) + "</div>" +
        MarketFormat.changeHtml(quote) + "</div>" + (trailingHtml || "") +
      "</div>"
    );
  }

  static card(quote) {
    var symbol = MarketFormat.escape(quote.symbol);
    return (
      "<div class='mkt-stock-card' data-open-symbol='" + symbol + "'>" +
        MarketFormat.avatarHtml(quote.symbol) +
        "<div class='mkt-row-main'>" +
          "<div class='mkt-name'>" + MarketFormat.escape(MarketFormat.displayName(quote)) + "</div>" +
          "<div class='mkt-symbol'>" + symbol + "</div>" +
        "</div>" +
        "<div class='text-end'><div class='mkt-price'>" + MarketFormat.price(quote.lastPrice) + "</div>" +
        MarketFormat.changeHtml(quote) + "</div>" +
      "</div>"
    );
  }

  static tile(quote) {
    var symbol = MarketFormat.escape(quote.symbol);
    return (
      "<div class='mkt-tile' data-open-symbol='" + symbol + "'>" +
        MarketFormat.avatarHtml(quote.symbol) +
        "<div class='mkt-name mt-3' title='" + MarketFormat.escape(MarketFormat.displayName(quote)) + "'>" +
          MarketFormat.escape(MarketFormat.displayName(quote)) + "</div>" +
        "<div class='mkt-price mt-2'>" + MarketFormat.price(quote.lastPrice) + "</div>" +
        MarketFormat.changeHtml(quote) +
      "</div>"
    );
  }

  static skeletons(count) {
    return new Array(count + 1).join("<div class='mkt-skeleton mb-2'></div>");
  }

  static message(text) {
    return "<p class='text-muted-custom small text-center py-3 mb-0'>" + MarketFormat.escape(text) + "</p>";
  }
}


// Horizontal row of large-cap cards plus the ranked Movers and Trending lists,
// all fed from one batched quote request for the stock universe.
class StockUniversePanels {
  constructor(quoteService) {
    this.quoteService = quoteService;
    this.universeQuotes = [];
    this.moversDirection = "gainers";
  }

  load() {
    var self = this;
    $("#popularStocksRow, #moversList, #trendingList").html(QuoteMarkup.skeletons(4));
    this.quoteService.fetchQuotes(MARKET_SYMBOLS.universe)
      .done(function (quotes) {
        self.universeQuotes = quotes;
        self.renderAll();
      })
      .fail(function (jqXHR) {
        $("#popularStocksRow, #moversList, #trendingList").html(QuoteMarkup.message("Quotes unavailable right now."));
        MarketsPage.showError(extractApiErrorMessage(jqXHR));
      });
  }

  renderAll() {
    this.renderPopular();
    this.renderMovers();
    this.renderTrending();
  }

  renderPopular() {
    var popularQuotes = this.universeQuotes.filter(function (quote) {
      return MARKET_SYMBOLS.popular.indexOf(quote.symbol) !== -1;
    });
    $("#popularStocksRow").html(popularQuotes.map(QuoteMarkup.card).join(""));
  }

  renderMovers() {
    var isGainers = this.moversDirection === "gainers";
    var movers = this.universeQuotes
      .filter(function (quote) { return isGainers ? quote.changePercent > 0 : quote.changePercent < 0; })
      .sort(function (a, b) { return isGainers ? b.changePercent - a.changePercent : a.changePercent - b.changePercent; })
      .slice(0, 6);
    var emptyText = isGainers ? "No gainers yet today." : "No losers yet today.";
    var rowsHtml = movers.map(function (quote) { return QuoteMarkup.row(quote); }).join("");
    $("#moversList").html(rowsHtml || QuoteMarkup.message(emptyText));
  }

  renderTrending() {
    var trending = this.universeQuotes
      .slice()
      .sort(function (a, b) { return (Number(b.volume) || 0) - (Number(a.volume) || 0); })
      .slice(0, 6);
    $("#trendingList").html(trending.map(function (quote) { return QuoteMarkup.row(quote); }).join(""));
  }

  bindMoversToggle() {
    var self = this;
    $("#moversToggle").on("click", ".mkt-chip", function () {
      $("#moversToggle .mkt-chip").removeClass("active");
      $(this).addClass("active");
      self.moversDirection = $(this).data("direction");
      self.renderMovers();
    });
  }
}


// ETF grid with category tabs; each category is fetched once and cached.
class EtfCategoryPanel {
  constructor(quoteService) {
    this.quoteService = quoteService;
    this.quotesByCategory = {};
    this.activeCategory = "leaders";
  }

  bindTabs() {
    var self = this;
    $("#etfTabs").on("click", "button", function () {
      $("#etfTabs button").removeClass("active");
      $(this).addClass("active");
      self.show($(this).data("category"));
    });
  }

  show(category) {
    this.activeCategory = category;
    if (this.quotesByCategory[category]) {
      this.render(category);
      return;
    }
    $("#etfGrid").html(QuoteMarkup.skeletons(2));
    this.fetchCategory(category);
  }

  fetchCategory(category) {
    var self = this;
    this.quoteService.fetchQuotes(MARKET_SYMBOLS.etfs[category])
      .done(function (quotes) {
        self.quotesByCategory[category] = quotes;
        self.render(category);
      })
      .fail(function () {
        $("#etfGrid").html(QuoteMarkup.message("ETF quotes unavailable right now."));
      });
  }

  render(category) {
    if (category !== this.activeCategory) {
      return;
    }
    $("#etfGrid").html(this.quotesByCategory[category].map(QuoteMarkup.tile).join(""));
  }
}


// Symbols the user opened recently, kept in this browser only.
class RecentlyViewedPanel {
  constructor(quoteService) {
    this.quoteService = quoteService;
    this.store = StoredSymbolList.recentlyViewed();
  }

  record(symbol) {
    this.store.addToFront(symbol);
    this.load();
  }

  load() {
    var symbols = this.store.read();
    $("#recentlyViewedPanel").toggleClass("d-none", symbols.length === 0);
    if (!symbols.length) {
      return;
    }
    this.quoteService.fetchQuotes(symbols).done(function (quotes) {
      $("#recentlyViewedRow").html(quotes.map(RecentlyViewedPanel.itemHtml).join(""));
    });
  }

  static itemHtml(quote) {
    var symbol = MarketFormat.escape(quote.symbol);
    var percent = Number(quote.changePercent) || 0;
    var direction = percent >= 0 ? "up" : "down";
    return (
      "<div class='mkt-recent' data-open-symbol='" + symbol + "'>" +
        MarketFormat.avatarHtml(quote.symbol) +
        "<div class='fw-semibold small'>" + symbol + "</div>" +
        "<div class='mkt-change change-" + direction + "'>" + (percent >= 0 ? "+" : "") + percent.toFixed(2) + "%</div>" +
      "</div>"
    );
  }

  bindClear() {
    var self = this;
    $("#clearRecentlyViewed").on("click", function () {
      self.store.write([]);
      self.load();
    });
  }
}


// Watchlist saved in this browser (the backend has no watchlist endpoint yet).
class WatchlistPanel {
  constructor(quoteService) {
    this.quoteService = quoteService;
    this.store = StoredSymbolList.watchlist();
  }

  contains(symbol) {
    return this.store.has(symbol);
  }

  toggle(symbol) {
    if (this.contains(symbol)) {
      this.store.remove(symbol);
    } else {
      this.store.addToFront(symbol);
    }
    this.load();
  }

  load() {
    var symbols = this.store.read();
    $("#watchlistEmpty").toggleClass("d-none", symbols.length > 0);
    if (!symbols.length) {
      $("#watchlistItems").empty();
      return;
    }
    this.quoteService.fetchQuotes(symbols).done(function (quotes) {
      $("#watchlistItems").html(quotes.map(WatchlistPanel.itemHtml).join(""));
    });
  }

  static itemHtml(quote) {
    var removeButton =
      "<button class='mkt-remove-btn' data-remove-symbol='" + MarketFormat.escape(quote.symbol) + "' aria-label='Remove'>" +
      "<i class='bi bi-x-lg'></i></button>";
    return QuoteMarkup.row(quote, removeButton);
  }

  bindActions() {
    var self = this;
    $("#watchlistItems").on("click", "[data-remove-symbol]", function (event) {
      event.stopPropagation();
      self.toggle(String($(this).data("remove-symbol")));
    });
    $("#addFirstStockButton").on("click", function () {
      $("#symbolSearchInput").trigger("focus");
    });
  }
}


// US equity session clock (Eastern Time). Exchange holidays are not modelled.
class MarketSessionClock {
  static PHASES = [
    { start: 0, end: 240, label: "Pre-market opens in", isOpen: false },
    { start: 240, end: 570, label: "Pre-market · Opens in", isOpen: true },
    { start: 570, end: 960, label: "Market open · Closes in", isOpen: true },
    { start: 960, end: 1200, label: "After hours · Ends in", isOpen: true },
    { start: 1200, end: 1440, label: "Market closed", isOpen: false },
  ];

  start() {
    this.tick();
    setInterval(this.tick.bind(this), 1000);
  }

  easternTime() {
    return UsMarketSession.easternTime();
  }

  tick() {
    var now = this.easternTime();
    var isWeekend = now.weekday === "Saturday" || now.weekday === "Sunday";
    var minutes = now.secondsOfDay / 60;
    var phase = MarketSessionClock.PHASES.find(function (p) { return minutes >= p.start && minutes < p.end; });
    $("#sessionDay").text(now.weekday);
    if (isWeekend) {
      this.render("Market closed for the weekend", "", false, minutes);
      return;
    }
    var hasCountdown = phase.end < 1440;
    this.render(phase.label, hasCountdown ? this.countdown(phase.end * 60 - now.secondsOfDay) : "", phase.isOpen, minutes);
  }

  countdown(totalSeconds) {
    var hours = Math.floor(totalSeconds / 3600);
    var minutes = Math.floor((totalSeconds % 3600) / 60);
    var seconds = Math.floor(totalSeconds % 60);
    return hours + "h " + minutes + "m " + seconds + "s";
  }

  render(label, countdownText, isOpen, minutesOfDay) {
    var sessionStart = 240;
    var sessionLength = 960;
    var progress = Math.min(Math.max((minutesOfDay - sessionStart) / sessionLength, 0), 1);
    $("#sessionLabel").text(label);
    $("#sessionCountdown").text(countdownText);
    $("#sessionDot").toggleClass("is-open", isOpen);
    $("#sessionMarker").css("left", progress * 100 + "%");
  }
}


// Search box with a debounced dropdown of matching symbols.
class SymbolSearch {
  constructor() {
    this.debounceTimer = null;
    this.$input = $("#symbolSearchInput");
    this.$results = $("#symbolSearchResults");
  }

  bind() {
    var self = this;
    this.$input.on("input", function () {
      clearTimeout(self.debounceTimer);
      var criteria = $(this).val().trim();
      self.debounceTimer = setTimeout(function () { self.run(criteria); }, 350);
    });
    $(document).on("click", function (event) {
      if (!$(event.target).closest(".mkt-search").length) {
        self.$results.addClass("d-none");
      }
    });
  }

  run(criteria) {
    var self = this;
    if (!criteria) {
      this.$results.addClass("d-none").empty();
      return;
    }
    callBeyondlyApi("GET", "/marketdata/search/", { query: { criteria: criteria } })
      .done(function (response) { self.render(response.results || []); })
      .fail(function (jqXHR) { self.show(QuoteMarkup.message(extractApiErrorMessage(jqXHR))); });
  }

  render(results) {
    var rowsHtml = results.map(SymbolSearch.resultHtml).join("");
    this.show(rowsHtml || QuoteMarkup.message("No symbols match your search."));
  }

  show(html) {
    this.$results.html(html).removeClass("d-none");
  }

  // The vendor's search response shape isn't published, so read the likeliest fields.
  static resultHtml(result) {
    var symbol = String(result.symbol || result.Symbol || result.ticker || "");
    if (!symbol) {
      return "";
    }
    var name = result.description || result.name || result.companyName || result.exchange || "";
    return (
      "<div class='mkt-row' data-open-symbol='" + MarketFormat.escape(symbol) + "'>" +
        MarketFormat.avatarHtml(symbol) +
        "<div class='mkt-row-main'><div class='mkt-name'>" + MarketFormat.escape(symbol) + "</div>" +
        "<div class='mkt-symbol'>" + MarketFormat.escape(name) + "</div></div>" +
      "</div>"
    );
  }

  close() {
    this.$results.addClass("d-none");
    this.$input.val("");
  }
}


// Wires every panel together and sends symbol clicks to the stock page.
class MarketsPage {
  constructor() {
    var quoteService = new QuoteService();
    this.ticker = new EtfTickerStrip(quoteService);
    this.stockPanels = new StockUniversePanels(quoteService);
    this.etfPanel = new EtfCategoryPanel(quoteService);
    this.recentlyViewed = new RecentlyViewedPanel(quoteService);
    this.watchlist = new WatchlistPanel(quoteService);
    this.sessionClock = new MarketSessionClock();
    this.search = new SymbolSearch();
    this.liveQuotes = new LiveQuoteBoard();
  }

  static showError(message) {
    $("#marketsErrorAlert").text(message).removeClass("d-none");
  }

  bindEvents() {
    this.stockPanels.bindMoversToggle();
    this.etfPanel.bindTabs();
    this.recentlyViewed.bindClear();
    this.watchlist.bindActions();
    this.search.bind();
    this.bindSymbolClicks();
  }

  bindSymbolClicks() {
    $(document).on("click", "[data-open-symbol]", function () {
      var symbol = String($(this).data("open-symbol"));
      window.location.href = "stock.html?symbol=" + encodeURIComponent(symbol);
    });
  }

  loadData() {
    this.sessionClock.start();
    this.ticker.load();
    this.stockPanels.load();
    this.etfPanel.show("leaders");
    this.recentlyViewed.load();
    this.watchlist.load();
    this.liveQuotes.start();
  }
}


$(function () {
  if (!requireSignedInUser()) {
    return;
  }

  var page = new MarketsPage();
  page.bindEvents();
  page.loadData();
});
