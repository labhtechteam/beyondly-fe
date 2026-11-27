// Market-data helpers shared by the markets and stock pages.
var TICKER_ETF_SYMBOLS = ["SPY", "QQQ", "DIA", "XLF", "XLK", "XLE", "XLV"];
var AVATAR_COLORS = ["#7a3fd1", "#2f8f6b", "#c2410c", "#1d6fb8", "#b83280", "#0e7490", "#a16207"];


// US equity session times in New York. Exchange holidays aren't known here,
// so every weekday counts as a trading day.
class UsMarketSession {
  static REGULAR_OPEN_MINUTE = 570; // 9:30 ET
  static REGULAR_CLOSE_MINUTE = 960; // 16:00 ET

  static easternTime() {
    var parts = new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York", weekday: "long",
      hour: "numeric", minute: "numeric", second: "numeric", hourCycle: "h23",
    }).formatToParts(new Date());
    var valueOf = function (type) { return parts.find(function (part) { return part.type === type; }).value; };
    var seconds = Number(valueOf("hour")) * 3600 + Number(valueOf("minute")) * 60 + Number(valueOf("second"));
    return { weekday: valueOf("weekday"), secondsOfDay: seconds };
  }

  static isRegularSessionOpen() {
    var now = UsMarketSession.easternTime();
    var minutes = now.secondsOfDay / 60;
    var isWeekday = ["Saturday", "Sunday"].indexOf(now.weekday) === -1;
    return isWeekday && minutes >= UsMarketSession.REGULAR_OPEN_MINUTE && minutes < UsMarketSession.REGULAR_CLOSE_MINUTE;
  }
}


// Shared formatting helpers for prices, changes and symbol avatars.
class MarketFormat {
  static escape(text) {
    return $("<div>").text(text == null ? "" : String(text)).html();
  }

  static price(value) {
    if (value === null || value === undefined || value === "") {
      return "—";
    }
    var number = Number(value);
    return isFinite(number) ? "$" + number.toFixed(2) : "—";
  }

  static changeHtml(quote) {
    var change = Number(quote.change) || 0;
    var percent = Number(quote.changePercent) || 0;
    var direction = change >= 0 ? "up" : "down";
    var arrow = change >= 0 ? "bi-caret-up-fill" : "bi-caret-down-fill";
    var sign = change >= 0 ? "+" : "";
    return (
      "<span class='mkt-change change-" + direction + "'><i class='bi " + arrow + "'></i> " +
      sign + change.toFixed(2) + " (" + sign + percent.toFixed(2) + "%)</span>"
    );
  }

  static avatarHtml(symbol, extraClass) {
    var hash = 0;
    for (var i = 0; i < symbol.length; i++) {
      hash = (hash + symbol.charCodeAt(i) * (i + 1)) % AVATAR_COLORS.length;
    }
    var color = AVATAR_COLORS[hash];
    var initials = MarketFormat.escape(symbol.slice(0, 4));
    return "<span class='mkt-avatar " + (extraClass || "") + "' style='background:" + color + "'>" + initials + "</span>";
  }

  static displayName(quote) {
    return quote.companyName || quote.name || quote.symbol;
  }
}


// The vendor's payloads are usually bare lists but sometimes wrapped in an object.
class ResponseShape {
  static findList(value) {
    if (Array.isArray(value)) {
      return value;
    }
    if (value && typeof value === "object") {
      var nestedList = Object.values(value).find(Array.isArray);
      return nestedList || [];
    }
    return [];
  }
}


// Fetches quotes from the backend in one batched call per symbol list.
class QuoteService {
  fetchQuotes(symbols) {
    var deferred = $.Deferred();
    callBeyondlyApi("GET", "/marketdata/quote/", { query: { symbol: symbols.join(",") } })
      .done(function (response) {
        var quotes = QuoteService.toQuoteList(response.results);
        LiveQuote.rememberPreviousCloses(quotes);
        deferred.resolve(quotes);
      })
      .fail(deferred.reject);
    return deferred.promise();
  }

  static toQuoteList(results) {
    return ResponseShape.findList(results).filter(function (quote) { return quote && quote.symbol; });
  }
}


// An ordered list of symbols persisted in this browser's localStorage.
class StoredSymbolList {
  constructor(storageKey, maxLength) {
    this.storageKey = storageKey;
    this.maxLength = maxLength;
  }

  // The backend has no watchlist endpoint yet, so it lives in this browser.
  static watchlist() {
    return new StoredSymbolList("beyondly_watchlist", 50);
  }

  static recentlyViewed() {
    return new StoredSymbolList("beyondly_recently_viewed", 8);
  }

  read() {
    try {
      return JSON.parse(localStorage.getItem(this.storageKey)) || [];
    } catch (error) {
      return [];
    }
  }

  write(symbols) {
    localStorage.setItem(this.storageKey, JSON.stringify(symbols.slice(0, this.maxLength)));
  }

  has(symbol) {
    return this.read().indexOf(symbol) !== -1;
  }

  addToFront(symbol) {
    this.write([symbol].concat(this.remove(symbol)));
  }

  remove(symbol) {
    var remaining = this.read().filter(function (stored) { return stored !== symbol; });
    this.write(remaining);
    return remaining;
  }
}


// Scrolling ETF strip under the navbar; content is duplicated for a seamless loop.
class EtfTickerStrip {
  constructor(quoteService) {
    this.quoteService = quoteService;
    this.$track = $("#etfTickerTrack");
  }

  load() {
    var self = this;
    this.quoteService.fetchQuotes(TICKER_ETF_SYMBOLS).done(function (quotes) {
      var itemsHtml = quotes.map(self.itemHtml).join("");
      self.$track.html(itemsHtml + itemsHtml);
    });
  }

  itemHtml(quote) {
    var symbol = MarketFormat.escape(quote.symbol);
    return (
      "<span class='mkt-ticker-item' data-open-symbol='" + symbol + "'>" +
        "<strong>" + symbol + "</strong> <span data-live-price>" + MarketFormat.price(quote.lastPrice) + "</span> " +
        MarketFormat.changeHtml(quote) +
      "</span>"
    );
  }
}


// Live prices come from the backend websocket, which relays ViewTrade's
// Polygon stream. Each update carries the latest price ("c"); the day's
// change is worked out against the previous close from the REST quote.
var LIVE_QUOTES_PATH = "/ws/marketdata/quotes/";
var LIVE_QUOTES_UNAUTHORIZED_CODE = 4401;
var LIVE_QUOTES_MAX_SYMBOLS = 50;
var LIVE_QUOTES_MAX_RETRY_MS = 30000;
var LIVE_PREVIOUS_CLOSES = {};

class LiveQuote {
  static rememberPreviousCloses(quotes) {
    quotes.forEach(function (quote) {
      var previousClose = Number(quote.lastPrice) - Number(quote.change);
      if (isFinite(previousClose) && previousClose > 0) {
        LIVE_PREVIOUS_CLOSES[quote.symbol] = previousClose;
      }
    });
  }

  // Turns one stream update into the {symbol, lastPrice, change, changePercent}
  // shape the rest of the site renders. change is left out without a previous close.
  static fromUpdate(update) {
    var quote = { symbol: update.s, lastPrice: Number(update.c) };
    var previousClose = LIVE_PREVIOUS_CLOSES[update.s];
    if (previousClose && isFinite(quote.lastPrice)) {
      quote.change = quote.lastPrice - previousClose;
      quote.changePercent = (quote.change / previousClose) * 100;
    }
    return quote;
  }
}


// One websocket to the backend for a changing set of symbols. Reconnects
// with backoff and re-subscribes, except when the token is rejected.
class LiveQuoteSocket {
  constructor(onQuote) {
    this.onQuote = onQuote;
    this.symbols = [];
    this.socket = null;
    this.retryDelayMs = 1000;
  }

  static url() {
    var origin = BEYONDLY_API_BASE_URL.replace(/\/api\/?$/, "").replace(/^http/, "ws");
    return origin + LIVE_QUOTES_PATH + "?token=" + encodeURIComponent(getStoredAccessToken());
  }

  // Replaces the watched symbols, sending only the difference to the server.
  watch(symbols) {
    var next = symbols.slice(0, LIVE_QUOTES_MAX_SYMBOLS);
    var previous = this.symbols;
    this.symbols = next;
    this.send("unsubscribe", previous.filter(function (symbol) { return next.indexOf(symbol) === -1; }));
    this.send("subscribe", next.filter(function (symbol) { return previous.indexOf(symbol) === -1; }));
    if (!this.socket && next.length) {
      this.connect();
    }
  }

  connect() {
    var self = this;
    this.socket = new WebSocket(LiveQuoteSocket.url());
    this.socket.onopen = function () {
      self.retryDelayMs = 1000;
      self.send("subscribe", self.symbols);
    };
    this.socket.onmessage = function (event) { self.handleMessage(JSON.parse(event.data)); };
    this.socket.onclose = function (event) { self.handleClose(event); };
  }

  send(action, symbols) {
    if (symbols.length && this.socket && this.socket.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ action: action, symbols: symbols }));
    }
  }

  handleMessage(message) {
    if (message.type === "quotes") {
      message.updates.forEach(function (update) { this.onQuote(LiveQuote.fromUpdate(update)); }, this);
    }
  }

  handleClose(event) {
    this.socket = null;
    if (event.code === LIVE_QUOTES_UNAUTHORIZED_CODE || !this.symbols.length) {
      return;
    }
    setTimeout(this.connect.bind(this), this.retryDelayMs);
    this.retryDelayMs = Math.min(this.retryDelayMs * 2, LIVE_QUOTES_MAX_RETRY_MS);
  }
}


// Keeps every rendered quote on the page live: watches the symbols of
// elements that show a price and patches their price and change in place.
// pinnedSymbols are always watched, and onQuote (optional) sees every update.
class LiveQuoteBoard {
  constructor(pinnedSymbols, onQuote) {
    this.pinnedSymbols = pinnedSymbols || [];
    this.onQuote = onQuote || function () {};
    this.socket = new LiveQuoteSocket(this.patch.bind(this));
    this.rescanPending = false;
  }

  start() {
    new MutationObserver(this.scheduleRescan.bind(this)).observe(document.body, { childList: true, subtree: true });
    this.rescan();
  }

  // Throttled, so a steady stream of price patches can't keep postponing it.
  scheduleRescan() {
    if (this.rescanPending) {
      return;
    }
    this.rescanPending = true;
    setTimeout(this.rescan.bind(this), 300);
  }

  rescan() {
    this.rescanPending = false;
    var symbols = this.pinnedSymbols.slice();
    LiveQuoteBoard.priceHolders().each(function () {
      var symbol = $(this).attr("data-open-symbol");
      if (symbols.indexOf(symbol) === -1) {
        symbols.push(symbol);
      }
    });
    this.socket.watch(symbols);
  }

  static priceHolders() {
    return $("[data-open-symbol]").has(".mkt-price, [data-live-price]");
  }

  patch(quote) {
    this.onQuote(quote);
    var $holders = LiveQuoteBoard.priceHolders().filter(function () {
      return $(this).attr("data-open-symbol") === quote.symbol;
    });
    $holders.find(".mkt-price, [data-live-price]").text(MarketFormat.price(quote.lastPrice));
    if (quote.change !== undefined) {
      $holders.find(".mkt-change").replaceWith(MarketFormat.changeHtml(quote));
    }
  }
}
