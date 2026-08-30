// Configuration
const BANNER_URL = 'https://lhncbc.nlm.nih.gov/assets/shutdown-banner.json';
const BANNER_CLASS = 'shutdown-banner';
const TARGET_CONTAINER_CLASS = 'mor_status_spot';

// Function to create and inject the banner container
function createBannerContainer() {
  const existing = document.querySelector(`.${BANNER_CLASS}`);
  if (existing) return existing;

  const banner = document.createElement('div');
  banner.className = BANNER_CLASS;
  banner.style.display = 'none';

  const targetContainer = document.querySelector(`.${TARGET_CONTAINER_CLASS}`);

  if (targetContainer) {
    //console.log('Placing shutdown banner in .mor_status_spot'); // Optional: for debugging
    targetContainer.appendChild(banner);
  } else {
    //console.log('Fallback: Placing shutdown banner at the top of the body.'); // Optional: for debugging
    if (document.body.firstChild) {
      document.body.insertBefore(banner, document.body.firstChild);
    } else {
      document.body.appendChild(banner);
    }
  }

  // 5. Return the newly created and injected banner element.
  return banner;
}

// Function to parse message with inline link placeholders and create DOM elements
function createBannerContent(message, links) {
  const container = document.createDocumentFragment();

  if (!links || links.length === 0) {
    const textNode = document.createTextNode(message);
    container.appendChild(textNode);
    return container;
  }

  // Split message by link placeholders like {{0}}, {{1}}, etc.
  const parts = message.split(/(\{\{\d+\}\})/);

  parts.forEach(part => {
    const linkMatch = part.match(/\{\{(\d+)\}\}/);
    if (linkMatch) {
      const linkIndex = parseInt(linkMatch[1]);
      if (links[linkIndex]) {
        const link = document.createElement('a');
        link.href = links[linkIndex].url;
        link.textContent = links[linkIndex].text;
        link.setAttribute('target', '_blank');
        link.setAttribute('rel', 'noopener noreferrer');
        container.appendChild(link);
      }
    } else if (part) {
      container.appendChild(document.createTextNode(part));
    }
  });

  return container;
}

// Function to load and display the shutdown banner
async function loadShutdownBanner() {
  const bannerContainer = createBannerContainer();

  try {
    const response = await fetch(BANNER_URL); // Respects server's 60-second cache header

    if (!response.ok) {
      throw new Error(`HTTP error! status: ${response.status}`);
    }

    const data = await response.json();

    // Only display if active and has content
    if (data.active && data.message) {
      // This is the new line you will add
      if (bannerContainer.parentElement.classList.contains(TARGET_CONTAINER_CLASS)) bannerContainer.parentElement.className = 'banner-active';


      // Clear existing content
      bannerContainer.innerHTML = '';

      // Create banner content with links
      const content = createBannerContent(data.message, data.links);
      bannerContainer.appendChild(content);

      bannerContainer.style.display = 'block';
    } else {
      bannerContainer.style.display = 'none';
    }
  } catch (error) {
    console.error('Failed to load shutdown banner:', error);
    // Hide the container on error
    bannerContainer.style.display = 'none';
  }
}

// Initialize when DOM is ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', loadShutdownBanner);
} else {
  loadShutdownBanner();
}

document.addEventListener('DOMContentLoaded', function () {
  fetch('https://lhncbc.nlm.nih.gov/lhcFooter.frag')
    .then(response => {
      if (!response.ok) {
        throw new Error(`Failed to load footer: ${response.status} ${response.statusText}`);
      }
      return response.text();
    })

    .then(data => {
      const reImg = /<img.*?>/gs;
      const reBr = /<br.*?>/gs;
      const xmldata = data.replaceAll(reImg, (mat) => mat.substring(0, mat.length - 1) + "/>").replaceAll(reBr, (mat) => mat.substring(0, mat.length - 1) + "/>");
      const targetElements = document.querySelectorAll('.insertfooter');
      targetElements.forEach(function (element) {
        element.innerHTML = xmldata;

        // Find all img elements and modify their src attributes
        const images = element.querySelectorAll('img');
        images.forEach(function (img) {
          const currentSrc = img.getAttribute('src');
          if (currentSrc) {
            // Check if the URL already has query parameters
            const separator = currentSrc.includes('?') ? '&' : '?';
            img.setAttribute('src', currentSrc + separator + 'domain=' + window.location.hostname);
          }
        });

        // Find the support link within the inserted footer and update its href
        const supportLink = element.querySelector('.lhc-supportLink');
        if (supportLink) {
          const currentPageURL = window.location.origin + window.location.pathname;

          // Start building the support URL with the 'from' parameter
          let finalSupportURL = "https://support.nlm.nih.gov/support/create-case/?from=" + encodeURIComponent(currentPageURL);

          // Add the category parameter ONLY if LHCSupportCategory is defined and not null/empty
          if (typeof LHCSupportCategory !== 'undefined' && LHCSupportCategory !== null && LHCSupportCategory !== '') {
            // Append the category parameter with an '&' prefix
            finalSupportURL += `&category=${encodeURIComponent(LHCSupportCategory)}`;
          }

          supportLink.setAttribute("href", finalSupportURL);
        }
      });
    })
    .catch(error => console.error('Error loading footer:', error));
});