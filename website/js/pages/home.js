// Animates each ".stat-value" from 0 up to its data-target value.
function animateStatCounters() {
  $(".stat-value").each(function () {
    var $counter = $(this);
    var targetValue = parseInt($counter.data("target"), 10);

    $({ currentValue: 0 }).animate(
      { currentValue: targetValue },
      {
        duration: 1200,
        easing: "swing",
        step: function (now) {
          $counter.text(Math.ceil(now));
        },
        complete: function () {
          $counter.text(targetValue);
        },
      }
    );
  });
}

$(function () {
  animateStatCounters();
});
