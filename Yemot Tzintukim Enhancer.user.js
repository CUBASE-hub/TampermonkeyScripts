// ==UserScript==
// @name         Yemot Tzintukim Enhancer
// @namespace    http://tampermonkey.net/
// @version      1.7.3 // הוסרה אנימציית טעינה רק מדף רשימת הרשומים
// @description  Adds "Invited to list" column, updates totals on Yemot Tzintukim page, adds invited numbers with names to list entries page, and shows names for existing entries.
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
        #table_data tbody tr.custom-invited-row td:nth-child(4) { /* Status for invited */
             color: blue !important;
        }
        #table_data tbody tr td:nth-child(2).custom-has-name { /* Name column if name found - ללא הדגשה */
            /* font-weight: bold; */
        }

        /* Table-specific Loading Overlay Styles - KEPT FOR MAIN PAGE */
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

    // --- Loading Overlay Management - KEPT FOR MAIN PAGE ---
    let tableLoadingOverlay = null;
    const loadingGifSrc = "res/ajax-loader-small.gif"; // Adjust this path if needed

    function showTableLoadingOverlay(tableElement) {
        if (!tableElement) return;
        let positionedAncestor = tableElement.offsetParent || document.body;
        if (getComputedStyle(positionedAncestor).position === 'static') {
            if (getComputedStyle(tableElement.parentElement).position === 'static') {
                tableElement.parentElement.style.position = 'relative';
            }
            positionedAncestor = tableElement.parentElement;
        }

        if (!tableLoadingOverlay) {
            tableLoadingOverlay = document.createElement('div');
            tableLoadingOverlay.id = 'tm-table-loading-overlay';
            const loadingImg = document.createElement('img');
            try {
                const baseUrl = new URL(window.location.href);
                let gifPath = loadingGifSrc;
                if (!loadingGifSrc.startsWith('http') && !loadingGifSrc.startsWith('data:')) {
                    const ymIndex = baseUrl.pathname.indexOf('/ym/');
                    if (ymIndex !== -1) {
                        const basePathForYm = baseUrl.pathname.substring(0, ymIndex + '/ym/'.length);
                        gifPath = new URL(basePathForYm + loadingGifSrc, baseUrl.origin).href;
                    } else {
                        gifPath = new URL(loadingGifSrc, baseUrl.origin + baseUrl.pathname).href;
                    }
                }
                loadingImg.src = gifPath;
                // console.log("Loading GIF from:", gifPath); // Can be uncommented for debugging GIF path
            } catch (e) {
                loadingImg.src = loadingGifSrc;
                console.warn("Could not resolve loading GIF path, using as is:", loadingGifSrc, e);
            }
            tableLoadingOverlay.appendChild(loadingImg);
            positionedAncestor.appendChild(tableLoadingOverlay);
        }

        const tableRect = tableElement.getBoundingClientRect();
        const ancestorRect = tableLoadingOverlay.parentElement.getBoundingClientRect();
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


    // --- Helper: GM_xmlhttpRequest wrapper for HTML responses ---
    function gmFetchHtml(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || {},
                onload: function(response) {
                    if (response.status >= 200 && response.status < 300) {
                        const parser = new DOMParser();
                        const doc = parser.parseFromString(response.responseText, 'text/html');
                        resolve(doc);
                    } else {
                        console.error(`gmFetchHtml: Failed to load page ${url}: ${response.status} ${response.statusText}`);
                        reject(new Error(`Failed to load page: ${response.status}`));
                    }
                },
                onerror: function(error) {
                    console.error(`gmFetchHtml: GM_xmlhttpRequest error for ${url}:`, error);
                    reject(new Error('GM_xmlhttpRequest error'));
                },
                ontimeout: function() {
                    console.error(`gmFetchHtml: GM_xmlhttpRequest timeout for ${url}`);
                    reject(new Error('Request timed out'));
                }
            });
        });
    }

    // --- Helper: GM_xmlhttpRequest wrapper for JSON responses ---
    function gmFetchJson(url, options = {}) {
        return new Promise((resolve, reject) => {
            GM_xmlhttpRequest({
                method: options.method || 'GET',
                url: url,
                headers: options.headers || { 'Accept': 'application/json' },
                responseType: 'json',
                timeout: options.timeout || 15000,
                onload: function(response) {
                    if (response.status === 200) {
                        let jsonData = response.responseJson;
                        if (typeof jsonData === 'undefined') {
                            try {
                                jsonData = JSON.parse(response.responseText);
                            } catch (e) {
                                console.error(`gmFetchJson: Failed to parse JSON for ${url}:`, e, response.responseText.substring(0,500));
                                reject(new Error('Failed to parse JSON response'));
                                return;
                            }
                        }
                        resolve(jsonData);
                    } else {
                        console.error(`gmFetchJson: Failed to load JSON from ${url}: Status ${response.status}`, response.responseText.substring(0,500));
                        reject(new Error(`Failed to load JSON: Status ${response.status}`));
                    }
                },
                onerror: function(error) {
                    console.error(`gmFetchJson: GM_xmlhttpRequest error for ${url}:`, error);
                    reject(new Error(`GM_xmlhttpRequest error: ${error.details || error.error || 'Unknown error'}`));
                },
                ontimeout: function() {
                    console.error(`gmFetchJson: GM_xmlhttpRequest timeout for ${url}`);
                    reject(new Error('Request timed out for JSON'));
                }
            });
        });
    }


    // --- Function to fetch and parse PhonesName.ini ---
    async function fetchPhoneNamesMap() {
        const apiUrl = 'https://www.call2all.co.il/ym/ws.php?ws=YDDownloadIniFile&what=ivr2://PhonesName.ini';
        console.log("Fetching PhonesName.ini content from WS API:", apiUrl);
        try {
            const jsonData = await gmFetchJson(apiUrl);
            console.log("PhonesName API Response JSON:", jsonData);

            if (jsonData.responseStatus !== "OK") {
                console.error("PhonesName API responseStatus is not OK:", jsonData.responseStatus, "Full response:", jsonData);
                return null;
            }
            if (typeof jsonData.contents === 'undefined' || jsonData.contents === null) {
                console.warn("PhonesName API response OK but 'contents' is missing or null. This might mean PhonesName.ini does not exist or is empty.");
                return new Map();
            }

            const phonesNameContent = jsonData.contents;
            const namesMap = new Map();
            if (phonesNameContent.trim() !== "") {
                const lines = phonesNameContent.split(/\r?\n/);
                for (const line of lines) {
                    const parts = line.split('=');
                    if (parts.length === 2) {
                        const phone = parts[0].trim();
                        const name = parts[1].trim();
                        if (phone && name) {
                           namesMap.set(phone, name);
                        }
                    }
                }
            }
            console.log(`Successfully parsed ${namesMap.size} names from PhonesName.ini`);
            return namesMap;

        } catch (error) {
            console.error("Error fetching or parsing PhonesName.ini:", error);
            return null;
        }
    }


    // --- Functions for the main Tzintukim page (view=Tzintukim) ---
    function enhanceMainTzintukimPage() {
        console.log("Tampermonkey: Script running on Tzintukim main page.");
        const observer = new MutationObserver(async (mutationsList, obs) => {
            const table = document.getElementById(MAIN_TABLE_ID);
            if (table && table.querySelector('thead tr') && table.querySelector('tbody tr.listR')) {
                if (!table.dataset.tampermonkeyProcessed) {
                    table.dataset.tampermonkeyProcessed = "true";
                    obs.disconnect();
                    showTableLoadingOverlay(table); // USE loading overlay for main page
                    try {
                        await processMainTable(table);
                    } catch (e) {
                        console.error("Error during main table processing:", e);
                    } finally {
                        hideTableLoadingOverlay(); // HIDE loading overlay for main page
                    }
                }
            }
        });
        observer.observe(document.body, { childList: true, subtree: true });
    }

    function addHeaderToMainTable(table) {
        // ... (same as before)
        const headerRow = table.querySelector('thead tr');
        if (!headerRow || headerRow.querySelector('th.custom-invited-col')) return;
        const newTh = document.createElement('th');
        newTh.textContent = 'מוזמנים לרשימה';
        newTh.classList.add('custom-invited-col');
        const fourthTh = headerRow.children[3];
        if (fourthTh) fourthTh.parentNode.insertBefore(newTh, fourthTh.nextSibling);
        else headerRow.appendChild(newTh);
    }

    async function processMainTable(table) {
        // ... (same as before)
        addHeaderToMainTable(table);
        const rows = table.querySelectorAll('tbody tr.listR');
        const processingPromises = Array.from(rows).map(async (row) => {
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
            if (fourthTd) fourthTd.parentNode.insertBefore(newTd, fourthTd.nextSibling);
            else {
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

    async function fetchLogPageAndGetCount(url) {
        // ... (same as before)
        const doc = await gmFetchHtml(url);
        const logTable = doc.getElementById('table_data');
        if (!logTable) {
            console.warn(`No table_data found on ${url} for count`);
            return 0;
        }
        return filterLogTableForCount(logTable);
    }

    async function fetchLogPageAndGetInvitedPhones(url) {
        // ... (same as before)
        const doc = await gmFetchHtml(url);
        const logTable = doc.getElementById('table_data');
        if (!logTable) {
            console.warn(`No table_data found on ${url} for phones`);
            return [];
        }
        return filterLogTableForPhones(logTable);
    }

    function filterLogTableForCount(tableElement) {
        // ... (same as before)
        const rows = tableElement.querySelectorAll('tbody tr.listR');
        if (!rows || rows.length === 0) return 0;
        const phoneLastActionInfo = new Map();
        const targetActionType = "הזמנת מספר לרשימה";
        rows.forEach((row) => {
            const cells = row.cells;
            if (cells.length < 6) return;
            const actionType = cells[4].textContent.trim();
            const phoneNumber = cells[5].textContent.trim();
            if (phoneNumber) phoneLastActionInfo.set(phoneNumber, { type: actionType });
        });
        let validOrderCount = 0;
        phoneLastActionInfo.forEach((info) => {
            if (info.type === targetActionType) validOrderCount++;
        });
        return validOrderCount;
    }

    function filterLogTableForPhones(tableElement) {
        // ... (same as before)
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
            if (phoneNumber) phoneLastActionInfo.set(phoneNumber, { type: actionType, phone: phoneNumber });
        });
        phoneLastActionInfo.forEach((info) => {
            if (info.type === targetActionType) invitedPhones.push(info.phone);
        });
        return invitedPhones;
    }


    // ----- Functions for the "List Entries" page (action=getlistEnteres) -----
    async function enhanceListEntriesPage() {
        console.log("Tampermonkey: Script running on Tzintukim list entries page.");
        const listEntriesTable = document.getElementById(MAIN_TABLE_ID);
        if (listEntriesTable && listEntriesTable.querySelector('tbody') && !listEntriesTable.dataset.tampermonkeyProcessedEntries) {
             listEntriesTable.dataset.tampermonkeyProcessedEntries = "true";

            const urlParams = new URLSearchParams(window.location.search);
            const currentListName = urlParams.get('list');
            if (!currentListName) {
                console.error("List Entries Page: Could not determine current list name from URL.");
                return;
            }
            await processListEntries(currentListName, listEntriesTable);
        } else if (!listEntriesTable || !listEntriesTable.querySelector('tbody')) {
            const observer = new MutationObserver(async (mutationsList, obs) => {
                const table = document.getElementById(MAIN_TABLE_ID);
                if (table && table.querySelector('tbody')) {
                    if (!table.dataset.tampermonkeyProcessedEntries) {
                        table.dataset.tampermonkeyProcessedEntries = "true";
                        obs.disconnect();
                        const urlParams = new URLSearchParams(window.location.search);
                        const currentListName = urlParams.get('list');
                        if (!currentListName) {
                            console.error("List Entries Page (Observer): Could not determine current list name.");
                            return;
                        }
                        await processListEntries(currentListName, table);
                    }
                }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            console.log("List Entries Page: Table not immediately ready, observer started.");
        }
    }

    async function processListEntries(currentListName, listEntriesTable) {
        console.log("List Entries Page: Processing for list:", currentListName);
        // showTableLoadingOverlay(listEntriesTable); // REMOVED for list entries page
        // No loading overlay for this page as per request

        try {
            const phoneNamesMap = await fetchPhoneNamesMap();

            if (phoneNamesMap) {
                updateExistingRowsWithNames(listEntriesTable, phoneNamesMap);
            }

            const mainPageUrl = new URL('index.php?view=Tzintukim', window.location.origin + (window.location.pathname.includes('/ym/') ? '/ym/' : '/')).href;
            const mainPageDoc = await gmFetchHtml(mainPageUrl);
            const mainPageTable = mainPageDoc.getElementById(MAIN_TABLE_ID);

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

            const invitedPhones = await fetchLogPageAndGetInvitedPhones(logPageUrl);
            if (invitedPhones.length > 0) {
                addInvitedPhonesToEntriesTable(invitedPhones, listEntriesTable, phoneNamesMap || new Map());
            }

        } catch (error) {
            console.error("Error in processListEntries:", error);
        } /* finally { // No overlay to hide for this page
            // hideTableLoadingOverlay();
        } */
    }
    
    function updateExistingRowsWithNames(table, phoneNamesMap) {
        // ... (same as before)
        if (!phoneNamesMap || phoneNamesMap.size === 0) {
            console.log("No names map or empty map, skipping update of existing rows.");
            return;
        }
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        const existingRows = tbody.querySelectorAll('tr');
        existingRows.forEach(row => {
            if (row.cells.length >= 3) { 
                const phoneCell = row.cells[2]; 
                const nameCell = row.cells[1];  
                
                const phoneNumber = phoneCell.textContent.trim();
                if (phoneNumber && phoneNamesMap.has(phoneNumber)) {
                    const currentName = nameCell.textContent.trim();
                    const fetchedName = phoneNamesMap.get(phoneNumber);
                    if (!currentName || currentName !== fetchedName) {
                         nameCell.textContent = fetchedName;
                         console.log(`Updated name for existing entry ${phoneNumber} to ${fetchedName}`);
                    }
                }
            }
        });
    }


    function addInvitedPhonesToEntriesTable(phones, table, phoneNamesMap) {
        // ... (same as before)
        const tbody = table.querySelector('tbody');
        if (!tbody) return;

        let lastRowIndex = 0;
        const existingDataRows = Array.from(tbody.querySelectorAll('tr'))
            .filter(r => r.cells.length > 0 && r.cells[0].textContent.trim() !== '' && !isNaN(parseInt(r.cells[0].textContent)));

        if (existingDataRows.length > 0) {
            lastRowIndex = parseInt(existingDataRows[existingDataRows.length - 1].cells[0].textContent, 10);
        }

        phones.forEach(phone => {
            lastRowIndex++;
            const newRow = tbody.insertRow();
            newRow.classList.add('listR', 'custom-invited-row');

            const cellIndex = newRow.insertCell();
            cellIndex.textContent = lastRowIndex;

            const cellName = newRow.insertCell();
            const name = phoneNamesMap.get(phone);
            if (name) {
                cellName.textContent = name;
            } else {
                cellName.textContent = '';
            }

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
        enhanceMainTzintukimPage(); // This will use the loading overlay
    } else if (currentUrl.includes(ACTION_GET_LIST_ENTRIES)) {
        // This will NOT use the loading overlay for the table on this page
        if (document.readyState === "complete" || document.readyState === "interactive") {
            enhanceListEntriesPage();
        } else {
            window.addEventListener('DOMContentLoaded', enhanceListEntriesPage, { once: true });
        }
    }

})();
