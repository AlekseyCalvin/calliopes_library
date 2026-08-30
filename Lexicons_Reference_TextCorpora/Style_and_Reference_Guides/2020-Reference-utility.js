$(document).ready(function () {
  // Set the width of #utils and then resize as necessary
  function utilSize() {
    var contentWidth = $(".poem-home").width();
    $("#utils").width(contentWidth + 10);
  }
  utilSize();
  $(window).resize(function () {
    utilSize();
  });

  // Fix a weird issue where JQuery UI's close button
  // wasn't appearing after the Performant upgrades.
  // See https://stackoverflow.com/a/30340217
  $.widget("ui.dialog", $.ui.dialog, {
    open: function () {
      $(this.uiDialogTitlebarClose).html(
        `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x" viewBox="0 0 16 16">
        <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/>
      </svg><span class='ui-button-text'>Close</span>`
      );
      return this._super();
    },
  });

  // Tabs for poem resources and text
  $("#poem_resources").hide();
  $("#poem_text_tab").click(function (e) {
    e.preventDefault();
    $("#poem_resources").hide();
    $("#poem_text").show();
  });
  $("#poem_resources_tab").click(function (e) {
    e.preventDefault();
    $("#poem_text").hide();
    $("#poem_resources").show();
  });

  // Accordion for the sidebar
  $("#accordion").accordion({
    icons: { header: "ui-icon-plus", activeHeader: "ui-icon-minus" },
    activate: function (e, ui) {
      localStorage.setItem(
        "accordion-active",
        $(this).accordion("option", "active")
      );
    },
    active: +localStorage.getItem("accordion-active"),
  });

  // Tabs for the Instructions page
  $("#tabs").tabs();
});
