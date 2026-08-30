/* setTimeout(
    function() 
    {
     $( ".supportLink" ).attr("href", "https://support.nlm.nih.gov/support/create-case/?from=" + window.location.href);
    }, 1000) */


setTimeout(
function() 
{
  var category = "";
  if (window.location.href.indexOf("semanticnetwork") > -1){
    category="&category=semanticnetwork";
  } else if (window.location.href.indexOf("RxNav") > -1){
    category="&category=rxnav";
  } else if (window.location.href.indexOf("MOR") > -1){
    category="&category=rxnav";
  }
  $( ".supportLink" ).attr("href", "https://support.nlm.nih.gov/support/create-case/?from=" + window.location.href + category);
}, 1000)
