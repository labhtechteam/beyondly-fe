// Symbol suggestions for any input matching `inputSelector` inside `$root`.
// Uses GET /marketdata/search/; works for rows added after binding too.
// onPick(input, suggestion) runs after a suggestion fills the input.
var SYMBOL_EXCHANGE_KEYWORDS = ["nasdaq", "nyse", "bse", "nse"];

class SymbolSuggestion {
  // The vendor's search response shape isn't published, so read the likeliest fields.
  constructor(result) {
    this.symbol = String(result.symbol || result.Symbol || result.ticker || "").toUpperCase();
    this.name = String(result.description || result.name || result.companyName || "");
    this.exchangeText = String(result.exchange || result.primaryExchange || result.exchangeName || result.market || "");
  }

  // Maps the vendor exchange text onto our exchange values, or "" if unknown.
  exchangeName() {
    var text = this.exchangeText.toLowerCase();
    return SYMBOL_EXCHANGE_KEYWORDS.find((keyword) => text.indexOf(keyword) !== -1) || "";
  }

  html(index) {
    var escape = (text) => $("<div>").text(text).html();
    return "<div class='symbol-ac-item' data-index='" + index + "'>" +
      "<span class='symbol-ac-symbol'>" + escape(this.symbol) + "</span>" +
      "<span class='symbol-ac-name'>" + escape(this.name) + "</span>" +
      "<span class='symbol-ac-exchange'>" + escape(this.exchangeText) + "</span></div>";
  }
}

class SymbolAutocomplete {
  constructor(inputSelector, onPick) {
    this.inputSelector = inputSelector;
    this.onPick = onPick || function () {};
    this.debounceTimer = null;
    this.suggestions = [];
    this.activeIndex = -1;
    this.$input = null;
    this.$menu = $("<div class='symbol-ac-menu d-none' role='listbox'></div>");
  }

  bind($root) {
    $root.on("input", this.inputSelector, (event) => this.onInput(event.target));
    $root.on("keydown", this.inputSelector, (event) => this.onKeydown(event));
    $root.on("focusout", this.inputSelector, () => setTimeout(() => this.close(), 150));
    this.$menu.on("mousedown", ".symbol-ac-item", (event) => {
      event.preventDefault();
      this.pick(parseInt($(event.currentTarget).data("index"), 10));
    });
  }

  onInput(input) {
    this.attachTo(input);
    clearTimeout(this.debounceTimer);
    var criteria = input.value.trim();
    if (!criteria) {
      this.close();
      return;
    }
    this.debounceTimer = setTimeout(() => this.search(input, criteria), 300);
  }

  // Moves the shared dropdown under the input currently being typed in.
  attachTo(input) {
    if (this.$input && this.$input[0] === input) return;
    this.$input = $(input).attr("autocomplete", "off");
    this.$input.parent().addClass("symbol-ac-host").append(this.$menu);
  }

  search(input, criteria) {
    callBeyondlyApi("GET", "/marketdata/search/", { query: { criteria: criteria } })
      .done((response) => {
        if (input.value.trim() !== criteria) return; // a newer keystroke superseded this
        this.render((response.results || []).map((result) => new SymbolSuggestion(result)));
      })
      .fail((jqXHR) => this.showMessage(extractApiErrorMessage(jqXHR)));
  }

  render(suggestions) {
    this.suggestions = suggestions.filter((suggestion) => suggestion.symbol).slice(0, 8);
    this.activeIndex = -1;
    if (!this.suggestions.length) {
      this.showMessage("No symbols match.");
      return;
    }
    this.$menu.html(this.suggestions.map((suggestion, index) => suggestion.html(index)).join("")).removeClass("d-none");
  }

  showMessage(message) {
    this.suggestions = [];
    this.$menu.html($("<div class='symbol-ac-message'>").text(message)).removeClass("d-none");
  }

  onKeydown(event) {
    if (this.$menu.hasClass("d-none") || !this.suggestions.length) return;
    var keyActions = {
      ArrowDown: () => this.highlight(this.activeIndex + 1),
      ArrowUp: () => this.highlight(this.activeIndex - 1),
      Enter: () => this.pick(Math.max(this.activeIndex, 0)),
      Escape: () => this.close(),
    };
    if (!keyActions[event.key]) return;
    event.preventDefault();
    keyActions[event.key]();
  }

  highlight(index) {
    var count = this.suggestions.length;
    this.activeIndex = (index + count) % count;
    var $items = this.$menu.find(".symbol-ac-item").removeClass("active");
    $items.eq(this.activeIndex).addClass("active")[0].scrollIntoView({ block: "nearest" });
  }

  pick(index) {
    var suggestion = this.suggestions[index];
    if (!suggestion || !this.$input) return;
    this.$input.val(suggestion.symbol).trigger("change");
    this.close();
    this.onPick(this.$input[0], suggestion);
  }

  close() {
    clearTimeout(this.debounceTimer);
    this.$menu.addClass("d-none").empty();
    this.suggestions = [];
  }
}
