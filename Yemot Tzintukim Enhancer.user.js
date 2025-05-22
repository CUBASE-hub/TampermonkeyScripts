// ==UserScript==
// @name         Yemot Tzintukim Enhancer
// @namespace    http://tampermonkey.net/
// @version      1.6
// @description  Adds "Invited to list" column, updates totals on Yemot Tzintukim page, and adds invited numbers to list entries page with table-specific loading animation.
// @author       Jonny
// @match        https://*.call2all.co.il/ym/index.php?view=Tzintukim
// @match        https://*.call2all.co.il/ym/index.php?view=Tzintukim&action=getlistEnteres&list=*
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @connect      self
// @connect      *.call2all.co.il
// @updateURL    https://github.com/CUBASE-hub/TampermonkeyScripts/raw/refs/heads/main/Yemot%20Tzintukim%20Enhancer.user.js
// @downloadURL  https://github.com/CUBASE-hub/TampermonkeyScripts/raw/refs/heads/main/Yemot%20Tzintukim%20Enhancer.user.js
// ==/UserScript==

(function() {
    'use strict';

    // --- CSS Styles ---
    GM_addStyle(`
        th.custom-invited-col {
            width: 100px !important;
        }
        td.custom-invited-col-data {
            color: blue !important;
        }
        #table_data tbody tr.custom-invited-row td:nth-child(4) {
             color: blue !important;
        }

        /* Table-specific Loading Overlay Styles */
        #tm-table-loading-overlay {
            position: absolute; /* Positioned relative to nearest positioned ancestor */
            background-color: rgba(255, 255, 255, 0.85);
            z-index: 1000; /* High enough to cover table, adjust if needed */
            display: flex;
            justify-content: center;
            align-items: center;
            pointer-events: auto; /* Blocks clicks */
            /* Will be sized and positioned by JavaScript */
        }
        #tm-table-loading-overlay img {
            /* Styles for the GIF if needed */
        }
    `);

    // --- Constants ---
    const MAIN_PAGE_IDENTIFIER = "view=Tzintukim";
    const ACTION_GET_LIST_ENTRIES = "action=getlistEnteres";
    const ACTION_GET_LOG_LIST = "action=getLogList";
    const MAIN_TABLE_ID = 'table_data';

    // --- Loading Overlay Management ---
    let tableLoadingOverlay = null;
    const loadingGifSrc = "res/ajax-loader-small.gif"; // Adjust this path if needed

    function showTableLoadingOverlay(tableElement) {
        if (!tableElement) return;

        // Ensure the table's parent (or an ancestor) is positioned for correct overlay placement
        let positionedAncestor = tableElement.offsetParent || document.body;
        if (getComputedStyle(positionedAncestor).position === 'static') {
            // If no positioned ancestor is found easily, making body relative is a fallback,
            // but ideally, a closer wrapper should be used or made relative.
            // For now, we'll assume the table's direct parent can serve this role or is already positioned.
             if (getComputedStyle(tableElement.parentElement).position === 'static') {
                 tableElement.parentElement.style.position = 'relative'; // Make parent relative
             }
             positionedAncestor = tableElement.parentElement;
        }


        if (!tableLoadingOverlay) {
            tableLoadingOverlay = document.createElement('div');
            tableLoadingOverlay.id = 'tm-table-loading-overlay';
            const loadingImg = document.createElement('img');
            try {
                const baseUrl = new URL(window.location.href);
                // Assuming res/ is at the root of the domain or relative to the current path segment
                let gifPath = loadingGifSrc;
                if (!loadingGifSrc.startsWith('http') && !loadingGifSrc.startsWith('data:')) {
                     // Simple relative path construction: assumes 'res' is in the same dir or one level up from index.php
                    const pathSegments = baseUrl.pathname.split('/');
                    pathSegments.pop(); // Remove 'index.php' or last segment
                    // Check if 'ym' is part of path, if so, res might be relative to 'ym' or its parent
                    // This is a heuristic and might need adjustment based on actual site structure
                    if (pathSegments.includes('ym')) {
                         gifPath = pathSegments.slice(0, pathSegments.indexOf('ym') + 1).join('/') + '/' + loadingGifSrc;
                    } else {
                        gifPath = pathSegments.join('/') + '/' + loadingGifSrc;
                    }
                    // A more robust way if `res` is always at root of domain:
                    // gifPath = baseUrl.origin + '/' + loadingGifSrc;
                    // Or if always relative to /ym/
                    // gifPath = baseUrl.origin + (baseUrl.pathname.substring(0, baseUrl.pathname.indexOf('/ym/') + '/ym/'.length)) + loadingGifSrc;

                    // Let's try a common structure for call2all:
                    const ymIndex = baseUrl.pathname.indexOf('/ym/');
                    if (ymIndex !== -1) {
                        const basePathForYm = baseUrl.pathname.substring(0, ymIndex + '/ym/'.length);
                        gifPath = new URL(basePathForYm + loadingGifSrc, baseUrl.origin).href;
                    } else {
                        gifPath = new URL(loadingGifSrc, baseUrl.origin + baseUrl.pathname).href; // Default relative
                    }
                }
                loadingImg.src = gifPath;
                console.log("Loading GIF from:", gifPath);

            } catch (e) {
                loadingImg.src = loadingGifSrc; // Fallback
                console.warn("Could not resolve loading GIF path, using as is:", loadingGifSrc, e);
            }
            tableLoadingOverlay.appendChild(loadingImg);
            // Append to the positioned ancestor, not as a child of the table
            positionedAncestor.appendChild(tableLoadingOverlay);
        }

        // Dynamically set size and position based on the table's current dimensions and location
        const tableRect = tableElement.getBoundingClientRect();
        const ancestorRect = tableLoadingOverlay.parentElement.getBoundingClientRect(); // Recalculate parent rect

        // Calculate position relative to the positioned ancestor
        tableLoadingOverlay.style.top = `${tableRect.top - ancestorRect.top + tableLoadingOverlay.parentElement.scrollTop}px`;
        tableLoadingOverlay.style.left = `${tableRect.left - ancestorRect.left + tableLoadingOverlay.parentElement.scrollLeft}px`;
        tableLoadingOverlay.style.width = `${tableRect.width}px`;
        tableLoadingOverlay.style.height = `${tableRect.height}px`;

        tableLoadingOverlay.style.display = 'flex';
    }

    function hideTableLoadingOverlay() {
        if (tableLoadingOverlay && tableLoadingOverlay.parentNode) {
            tableLoadingOverlay.parentNode.removeChild(tableLoadingOverlay);
            tableLoadingOverlay = null;
        }
    }

    // Function to run on the main Tzintukim page
    function enhanceMainTzintukimPage() {
        console.log("Tampermonkey: Script running on Tzintukim main page.");

        const observer = new MutationObserver(async (mutationsList, obs) => {
            const table = document.getElementById(MAIN_TABLE_ID);
            if (table && table.querySelector('thead tr') && table.querySelector('tbody tr.listR')) {
                if (!table.dataset.tampermonkeyProcessed) {
                    table.dataset.tampermonkeyProcessed = "true"; // Mark as processed early
                    obs.disconnect(); // Stop observing

                    showTableLoadingOverlay(table);
                    try {
                        await processMainTable(table);
                    } catch (e) {
                        console.error("Error during main table processing:", e);
                    } finally {
                        hideTableLoadingOverlay();
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    // ... [Rest of the functions: addHeaderToMainTable, processMainTable, filterLogTableForCount, etc. remain the same] ...
    function addHeaderToMainTable(table) {
        const headerRow = table.querySelector('thead tr');
        if (!headerRow || headerRow.querySelector('th.custom-invited-col')) return;

        const newTh = document.createElement('th');
        newTh.textContent = 'מוזמנים לרשימה';
        newTh.classList.add('custom-invited-col');

        const fourthTh = headerRow.children[3];
        if (fourthTh) {
            fourthTh.parentNode.insertBefore(newTh, fourthTh.nextSibling);
        } else {
            headerRow.appendChild(newTh);
        }
    }

    async function processMainTable(table) {
        addHeaderToMainTable(table);
        const rows = table.querySelectorAll('tbody tr.listR');
        console.log(`Main page: Found ${rows.length} rows to process.`);

        const processingPromises = Array.from(rows).map(async (row) => {
            // Prevent re-processing if somehow missed by table.dataset.tampermonkeyProcessed
            if (row.dataset.tampermonkeyRowProcessedForLoading) return;
            row.dataset.tampermonkeyRowProcessedForLoading = "true";


            const viewLogButton = row.querySelector('a[href*="action=getLogList"]');
            let invitedCount = 0;

            if (viewLogButton) {
                const logUrl = new URL(viewLogButton.getAttribute('href'), window.location.href).href;
                try {
                    invitedCount = await fetchLogPageAndGetCount(logUrl);
                } catch (error) {
                    console.error(`Error processing log page ${logUrl} for count:`, error);
                    invitedCount = -1;
                }
            } else {
                invitedCount = -2;
            }

            const newTd = document.createElement('td');
            newTd.classList.add('custom-invited-col-data');
            if (invitedCount === -1) newTd.textContent = 'שגיאה';
            else if (invitedCount === -2) newTd.textContent = 'N/A';
            else newTd.textContent = invitedCount;

            const fourthTd = row.children[3];
            if (fourthTd) {
                fourthTd.parentNode.insertBefore(newTd, fourthTd.nextSibling);
            } else {
                 const actionsCell = row.cells[row.cells.length -1];
                if(actionsCell) actionsCell.parentNode.insertBefore(newTd, actionsCell);
                else row.appendChild(newTd);
            }

            if (invitedCount >= 0) {
                const registeredCountCell = row.cells[1];
                if (registeredCountCell) {
                    const currentRegistered = parseInt(registeredCountCell.textContent, 10) || 0;
                    registeredCountCell.textContent = currentRegistered + invitedCount;
                }
            }
        });

        await Promise.all(processingPromises);
        console.log("Tampermonkey: Main table processing complete.");
    }


    // ----- Functions for fetching and filtering log data -----
    // (filterLogTableForCount, filterLogTableForPhones, gmFetch, fetchLogPageAndGetCount, fetchLogPageAndGetInvitedPhones - unchanged from previous version)
    function filterLogTableForCount(tableElement) {
        const rows = tableElement.querySelectorAll('tbody tr.listR');
        if (!rows || rows.length === 0) return 0;

        const phoneLastActionInfo = new Map();
        const targetActionType = "הזמנת מספר לרשימה";
        rows.forEach((row) => {
            const cells = row.cells;
            if (cells.length < 6) return;
            const actionType = cells[4].textContent.trim();
            const phoneNumber = cells[5].textContent.trim();
            if (phoneNumber) {
                phoneLastActionInfo.set(phoneNumber, { type: actionType });
            }
        });
        let validOrderCount = 0;
        phoneLastActionInfo.forEach((info) => {
            if (info.type === targetActionType) validOrderCount++;
        });
        return validOrderCount;
    }

    function filterLogTableForPhones(tableElement) {
        const rows = tableElement.querySelectorAll('tbody tr.listR');
        const invitedPhones = [];
        if (!rows || rows.length === 0) return invitedPhones;

        const phoneLastActionInfo = new Map();
        const targetActionType = "הזמנת מספר לרשימה";
        rows.forEach((row) => {
            const cells = row.cells;
            if (cells.length < 6) return;
            const actionType = cells[4].textContent.trim();
            const phoneNumber = cells[5].textContent.trim();
            if (phoneNumber) {
                phoneLastActionInfo.set(phoneNumber, { type: actionType, phone: phoneNumber });
            }
        });
        phoneLastActionInfo.forEach((info) => {
            if (info.type === targetActionType) invitedPhones.push(info.phone);
        });
        return invitedPhones;
    }

    function gmFetch(url) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: 'GET',
                url: url,
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        resolve(doc);
                    } else {
                        console.error(`Failed to load page ${url}: ${response.status} ${response.statusText}`);
                        reject(new Error(`Failed to load page: ${response.status}`));
                    }
                },
                onerror: function(error) {
                    console.error(`GM_xmlhttpRequest error for ${url}:`, error);
                    reject(new Error('GM_xmlhttpRequest error'));
                }
            });
        });
    }

    async function fetchLogPageAndGetCount(url) {
        const doc = await gmFetch(url);
        const logTable = doc.getElementById('table_data');
        if (!logTable) {
            console.warn(`No table_data found on ${url} for count`);
            return 0;
        }
        return filterLogTableForCount(logTable);
    }

    async function fetchLogPageAndGetInvitedPhones(url) {
        const doc = await gmFetch(url);
        const logTable = doc.getElementById('table_data');
        if (!logTable) {
            console.warn(`No table_data found on ${url} for phones`);
            return [];
        }
        return filterLogTableForPhones(logTable);
    }


    // ----- Functions for the "List Entries" page -----
    // (enhanceListEntriesPage, processListEntries, addInvitedPhonesToEntriesTable - unchanged)
    async function enhanceListEntriesPage() {
        console.log("Tampermonkey: Script running on Tzintukim list entries page.");

        const urlParams = new URLSearchParams(window.location.search);
        const currentListName = urlParams.get('list');
        if (!currentListName) {
            console.error("List Entries Page: Could not determine current list name from URL.");
            return;
        }
        console.log("List Entries Page: Current list name:", currentListName);

        const listEntriesTableId = 'table_data';
        const observer = new MutationObserver(async (mutationsList, obs) => {
            const listEntriesTable = document.getElementById(listEntriesTableId);
            if (listEntriesTable && listEntriesTable.querySelector('tbody')) {
                 if (!listEntriesTable.dataset.tampermonkeyProcessedEntries) {
                    listEntriesTable.dataset.tampermonkeyProcessedEntries = "true";
                    obs.disconnect();
                    await processListEntries(currentListName, listEntriesTable);
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });

        const initialTable = document.getElementById(listEntriesTableId);
        if (initialTable && initialTable.querySelector('tbody') && !initialTable.dataset.tampermonkeyProcessedEntries) {
            initialTable.dataset.tampermonkeyProcessedEntries = "true";
            observer.disconnect();
            await processListEntries(currentListName, initialTable);
        }
    }

    async function processListEntries(currentListName, listEntriesTable) {
        try {
            const mainPageUrl = `${window.location.origin}${window.location.pathname}?view=Tzintukim`;
            const mainPageDoc = await gmFetch(mainPageUrl);
            const mainPageTable = mainPageDoc.getElementById('table_data');

            if (!mainPageTable) {
                console.error("List Entries Page: Could not find table_data on main Tzintukim page.");
                return;
            }

            let logPageUrl = null;
            const mainPageRows = mainPageTable.querySelectorAll('tbody tr.listR');
            for (const row of mainPageRows) {
                const listNameCell = row.cells[0];
                if (listNameCell && listNameCell.textContent.trim() === currentListName) {
                    const logLink = row.querySelector('a[href*="action=getLogList"]');
                    if (logLink) {
                        logPageUrl = new URL(logLink.getAttribute('href'), mainPageUrl).href;
                        break;
                    }
                }
            }

            if (!logPageUrl) {
                console.error(`List Entries Page: Could not find log page URL for list: ${currentListName}`);
                return;
            }
            console.log("List Entries Page: Found log page URL:", logPageUrl);

            const invitedPhones = await fetchLogPageAndGetInvitedPhones(logPageUrl);
            console.log("List Entries Page: Invited phones for this list:", invitedPhones);

            if (invitedPhones.length > 0) {
                addInvitedPhonesToEntriesTable(invitedPhones, listEntriesTable);
            }

        } catch (error) {
            console.error("Error in processListEntries:", error);
        }
    }

    function addInvitedPhonesToEntriesTable(phones, table) {
        const tbody = table.querySelector('tbody');
        if (!tbody) {
            console.error("List Entries Page: Tbody not found in list entries table.");
            return;
        }

        let lastRowIndex = 0;
        const existingRows = Array.from(tbody.querySelectorAll('tr.listR'))
            .filter(r => r.cells.length > 0 && r.cells[0].textContent.trim() !== '' && !isNaN(parseInt(r.cells[0].textContent)));

        if (existingRows.length > 0) {
            lastRowIndex = parseInt(existingRows[existingRows.length - 1].cells[0].textContent, 10);
        }


        phones.forEach(phone => {
            lastRowIndex++;
            const newRow = tbody.insertRow();
            newRow.classList.add('listR', 'custom-invited-row');

            const cellIndex = newRow.insertCell();
            cellIndex.textContent = lastRowIndex;

            const cellName = newRow.insertCell();
            cellName.textContent = '';

            const cellPhone = newRow.insertCell();
            cellPhone.textContent = phone;

            const cellStatus = newRow.insertCell();
            cellStatus.textContent = 'מוזמן';
        });
        console.log(`List Entries Page: Added ${phones.length} invited phones to the table.`);
    }


    // ----- Script entry point -----
    const currentUrl = window.location.href;
    if (currentUrl.includes(MAIN_PAGE_IDENTIFIER) &&
        !currentUrl.includes(ACTION_GET_LIST_ENTRIES) &&
        !currentUrl.includes(ACTION_GET_LOG_LIST)) {
        enhanceMainTzintukimPage();
    } else if (currentUrl.includes(ACTION_GET_LIST_ENTRIES)) {
        enhanceListEntriesPage();
    }

})();
