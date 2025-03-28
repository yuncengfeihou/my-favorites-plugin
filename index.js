// Import from the core script (public/script.js)
import {
    saveSettingsDebounced,
    getCurrentChatId,
    eventSource,
    event_types,
    messageFormatting,
} from '../../../../script.js';

// Import from the extension helper script (public/scripts/extensions.js)
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
} from '../../../extensions.js';

// Import from the Popup utility script (public/scripts/popup.js)
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// Import from the general utility script (public/scripts/utils.js)
import {
    uuidv4,
    timestampToMoment,
} from '../../../utils.js';

// Plugin constants
const pluginName = 'my-favorites-plugin';
let favoritesPopup = null;
const ITEMS_PER_PAGE = 10;

// Define HTML snippet for favorite icon
const favoriteIconHtml = `
    <div class="mes_button favorite-toggle-icon" title="Favorite/Unfavorite">
        <i class="fa-regular fa-star"></i>
    </div>
`;

// Initialize extension settings
jQuery(async () => {
    console.log(`${pluginName}: Initializing...`);
    
    // Initialize extension settings
    if (!extension_settings[pluginName]) {
        extension_settings[pluginName] = { chats: {} };
    }
    
    // Load CSS
    const styleElement = document.createElement('style');
    styleElement.innerHTML = `
        .favorite-toggle-icon i.fa-solid.fa-star {
            color: gold;
        }
        
        .favorite-item {
            margin-bottom: 10px;
            padding: 10px;
            border: 1px solid #444;
            border-radius: 5px;
            background-color: rgba(0, 0, 0, 0.1);
        }
        
        .favorite-item .fav-meta {
            font-size: 0.9em;
            margin-bottom: 5px;
            color: #aaa;
        }
        
        .favorite-item .fav-note {
            font-style: italic;
            margin-bottom: 5px;
            color: #bbb;
        }
        
        .favorite-item .fav-preview {
            margin-bottom: 5px;
        }
        
        .favorite-item .fav-preview.deleted {
            color: #f66;
        }
        
        .favorite-item .fav-actions {
            display: flex;
            justify-content: flex-end;
            gap: 10px;
        }
        
        .favorite-item .fav-actions i {
            cursor: pointer;
            color: #bbb;
        }
        
        .favorite-item .fav-actions i:hover {
            color: white;
        }
        
        .favorite-pagination {
            display: flex;
            justify-content: center;
            gap: 5px;
            margin: 10px 0;
        }
        
        .favorite-pagination .page-item {
            cursor: pointer;
            padding: 5px 10px;
            border: 1px solid #444;
            border-radius: 3px;
        }
        
        .favorite-pagination .page-item.active {
            background-color: #2b5278;
        }
        
        #all-favorites-container .character-group {
            margin-bottom: 15px;
            padding: 10px;
            border: 1px solid #444;
            border-radius: 5px;
        }
        
        #all-favorites-container .character-group-title {
            font-weight: bold;
            margin-bottom: 10px;
        }
        
        #all-favorites-container .chat-entry-item {
            padding: 5px 10px;
            margin: 5px 0;
            cursor: pointer;
            border-radius: 3px;
        }
        
        #all-favorites-container .chat-entry-item:hover {
            background-color: rgba(255, 255, 255, 0.1);
        }
    `;
    document.head.appendChild(styleElement);
    
    try {
        // Inject sidebar button
        const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
        $('#data_bank_wand_container').append(inputButtonHtml);
        console.log(`${pluginName}: Added button to sidebar`);
        
        // Bind click event for sidebar button
        $('#my_plugin_favorites_button').on('click', () => {
            openFavoritesPopup();
        });
        
        // Inject settings HTML
        const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
        $('#translation_container').append(settingsHtml);
        console.log(`${pluginName}: Added settings UI`);
        
        // Bind click event for settings UI buttons
        $('#view-all-favorites-button').on('click', () => {
            renderAllFavoritesView();
        });
        
    } catch (error) {
        console.error(`${pluginName}: Error initializing UI:`, error);
    }
    
    // Setup event delegation for favorites icons
    $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);
    
    // Listen for chat update events to inject favorite icons
    eventSource.on(event_types.CHAT_UPDATED, injectFavoriteIcons);
    
    // Initial injection
    injectFavoriteIcons();
    
    console.log(`${pluginName}: Initialization complete`);
});

// Function to inject favorite icons into messages
function injectFavoriteIcons() {
    try {
        // Inject favorite icons into all messages
        $('.extraMesButtons:not(:has(.favorite-toggle-icon))').append(favoriteIconHtml);
        
        // Update icons state based on favorites data
        updateFavoriteIconsState();
        
    } catch (error) {
        console.error(`${pluginName}: Error injecting favorite icons:`, error);
    }
}

// Function to update the state of favorite icons
function updateFavoriteIconsState() {
    const chatId = getCurrentChatId();
    if (!chatId) return;
    
    const currentChat = extension_settings[pluginName].chats[chatId];
    if (!currentChat) return;
    
    // Get all message items
    $('.mes').each(function() {
        const messageId = $(this).attr('mesid');
        if (!messageId) return;
        
        // Check if this message is favorited
        const isFavorited = currentChat.items && currentChat.items.some(item => item.messageId === messageId);
        
        // Find the favorite icon for this message
        const iconElement = $(this).find('.favorite-toggle-icon i');
        
        // Update icon state
        if (isFavorited) {
            iconElement.removeClass('fa-regular').addClass('fa-solid');
        } else {
            iconElement.removeClass('fa-solid').addClass('fa-regular');
        }
    });
}

// Handle click on favorite icon
function handleFavoriteToggle(event) {
    const iconElement = $(event.target).closest('.favorite-toggle-icon').find('i');
    const messageElement = $(event.target).closest('.mes');
    const messageId = messageElement.attr('mesid');
    
    if (!messageId) {
        console.error(`${pluginName}: Could not find message ID`);
        return;
    }
    
    // Toggle icon state immediately for responsive UI
    const isFavorited = iconElement.hasClass('fa-solid');
    
    if (isFavorited) {
        // Unfavorite
        iconElement.removeClass('fa-solid').addClass('fa-regular');
        removeFavorite(getCurrentChatId(), messageId);
    } else {
        // Favorite
        iconElement.removeClass('fa-regular').addClass('fa-solid');
        addFavorite(messageElement);
    }
}

// Add a message to favorites
function addFavorite(messageElement) {
    try {
        const context = getContext();
        const chatId = getCurrentChatId();
        
        if (!chatId || !context || !context.chat) {
            console.error(`${pluginName}: Missing context or chat ID`);
            return;
        }
        
        // Get message ID
        const messageId = messageElement.attr('mesid');
        
        // Find the message in the chat
        const message = context.chat.find(msg => msg.id === messageId);
        if (!message) {
            console.error(`${pluginName}: Message not found in chat`);
            return;
        }
        
        // Prepare favorite item
        const favoriteItem = {
            id: uuidv4(),
            messageId: messageId,
            sender: message.name,
            role: message.is_user ? 'user' : 'character',
            timestamp: message.send_date || Date.now(),
        };
        
        // Initialize chat entry if it doesn't exist
        if (!extension_settings[pluginName].chats[chatId]) {
            extension_settings[pluginName].chats[chatId] = {
                type: context.groupId ? 'group' : 'private',
                name: context.groupId ? context.groups.find(g => g.id === context.groupId)?.name : context.name2,
                count: 0,
                items: []
            };
            
            // Add characterId or groupId based on type
            if (context.groupId) {
                extension_settings[pluginName].chats[chatId].groupId = context.groupId;
            } else {
                extension_settings[pluginName].chats[chatId].characterId = context.characterId;
            }
        }
        
        // Add item to favorites
        extension_settings[pluginName].chats[chatId].items = extension_settings[pluginName].chats[chatId].items || [];
        extension_settings[pluginName].chats[chatId].items.push(favoriteItem);
        extension_settings[pluginName].chats[chatId].count = extension_settings[pluginName].chats[chatId].items.length;
        
        // Save settings
        saveSettingsDebounced();
        
        // Update favorites popup if open
        if (favoritesPopup && favoritesPopup.isOpen) {
            updateFavoritesPopup(chatId);
        }
        
        console.log(`${pluginName}: Added message to favorites`, favoriteItem);
        
    } catch (error) {
        console.error(`${pluginName}: Error adding favorite:`, error);
    }
}

// Remove a message from favorites
function removeFavorite(chatId, messageId) {
    try {
        if (!chatId || !messageId) {
            console.error(`${pluginName}: Missing chat ID or message ID`);
            return;
        }
        
        const chat = extension_settings[pluginName].chats[chatId];
        if (!chat || !chat.items) {
            console.error(`${pluginName}: Chat or items not found`);
            return;
        }
        
        // Find and remove the item
        const initialLength = chat.items.length;
        chat.items = chat.items.filter(item => item.messageId !== messageId);
        
        // Update count and save if something was removed
        if (chat.items.length < initialLength) {
            chat.count = chat.items.length;
            
            // If no items left, remove the chat entry
            if (chat.count === 0) {
                delete extension_settings[pluginName].chats[chatId];
            }
            
            // Save settings
            saveSettingsDebounced();
            
            // Update favorites popup if open
            if (favoritesPopup && favoritesPopup.isOpen) {
                updateFavoritesPopup(chatId);
            }
            
            console.log(`${pluginName}: Removed message from favorites`);
        }
        
    } catch (error) {
        console.error(`${pluginName}: Error removing favorite:`, error);
    }
}

// Remove a favorite by its ID
function removeFavoriteById(chatId, favoriteId) {
    try {
        if (!chatId || !favoriteId) {
            console.error(`${pluginName}: Missing chat ID or favorite ID`);
            return;
        }
        
        const chat = extension_settings[pluginName].chats[chatId];
        if (!chat || !chat.items) {
            console.error(`${pluginName}: Chat or items not found`);
            return;
        }
        
        // Find the item to get the messageId
        const item = chat.items.find(item => item.id === favoriteId);
        if (!item) {
            console.error(`${pluginName}: Favorite item not found`);
            return;
        }
        
        const messageId = item.messageId;
        
        // Find and remove the item
        const initialLength = chat.items.length;
        chat.items = chat.items.filter(item => item.id !== favoriteId);
        
        // Update count and save if something was removed
        if (chat.items.length < initialLength) {
            chat.count = chat.items.length;
            
            // If no items left, remove the chat entry
            if (chat.count === 0) {
                delete extension_settings[pluginName].chats[chatId];
            }
            
            // Save settings
            saveSettingsDebounced();
            
            // Update favorites popup if open
            if (favoritesPopup && favoritesPopup.isOpen) {
                updateFavoritesPopup(chatId);
            }
            
            // Update icon state in the chat if message is visible
            const messageElement = $(`.mes[mesid="${messageId}"]`);
            if (messageElement.length > 0) {
                const iconElement = messageElement.find('.favorite-toggle-icon i');
                iconElement.removeClass('fa-solid').addClass('fa-regular');
            }
            
            console.log(`${pluginName}: Removed favorite by ID`);
        }
        
    } catch (error) {
        console.error(`${pluginName}: Error removing favorite by ID:`, error);
    }
}

// Open the favorites popup
function openFavoritesPopup() {
    const chatId = getCurrentChatId();
    if (!chatId) {
        callGenericPopup('No active chat found.', POPUP_TYPE.ALERT);
        return;
    }
    
    if (!favoritesPopup) {
        // Create new popup
        favoritesPopup = new Popup('Favorites', 'favorites-popup-content', 'auto-height');
        favoritesPopup.addCloseButton();
        
        // Add event delegation for popup actions
        $(document).on('click', '#favorites-list-container .fa-pencil', handleEditNote);
        $(document).on('click', '#favorites-list-container .fa-trash', handleDeleteFavorite);
        $(document).on('click', '#clear-invalid-favorites', () => handleClearInvalidFavorites(chatId));
        $(document).on('click', '#favorites-pagination .page-item', handlePaginationClick);
    }
    
    updateFavoritesPopup(chatId);
    favoritesPopup.show();
}

// Update the favorites popup content
function updateFavoritesPopup(chatId) {
    if (!favoritesPopup) return;
    
    try {
        const chat = extension_settings[pluginName].chats[chatId];
        const context = getContext();
        
        let content = '';
        
        // Set popup title
        let title = 'Favorites';
        if (chat) {
            title = `${chat.name} Favorites (${chat.count})`;
        }
        favoritesPopup.setTitle(title);
        
        // Generate content
        if (!chat || !chat.items || chat.items.length === 0) {
            content = '<div class="no-favorites">No favorites in this chat yet.</div>';
        } else {
            // Sort items by timestamp (ascending)
            const sortedItems = [...chat.items].sort((a, b) => a.timestamp - b.timestamp);
            
            // Calculate pagination
            const totalPages = Math.ceil(sortedItems.length / ITEMS_PER_PAGE);
            const currentPage = favoritesPopup.currentPage || 1;
            
            // Get items for current page
            const startIndex = (currentPage - 1) * ITEMS_PER_PAGE;
            const pageItems = sortedItems.slice(startIndex, startIndex + ITEMS_PER_PAGE);
            
            // Create pagination HTML
            let paginationHtml = '';
            if (totalPages > 1) {
                paginationHtml = '<div id="favorites-pagination" class="favorite-pagination">';
                for (let i = 1; i <= totalPages; i++) {
                    paginationHtml += `<div class="page-item ${i === currentPage ? 'active' : ''}" data-page="${i}">${i}</div>`;
                }
                paginationHtml += '</div>';
            }
            
            // Create content with list items
            content = `
                <div id="favorites-list-container">
                    ${pageItems.map(item => renderFavoriteItem(item, context)).join('')}
                </div>
                ${paginationHtml}
                <div class="favorites-buttons" style="margin-top: 15px; text-align: center;">
                    <button id="clear-invalid-favorites" class="menu_button">Clear Invalid Favorites</button>
                </div>
            `;
        }
        
        favoritesPopup.setContent(content);
        favoritesPopup.isOpen = true;
        
    } catch (error) {
        console.error(`${pluginName}: Error updating favorites popup:`, error);
    }
}

// Render a single favorite item
function renderFavoriteItem(favItem, context) {
    try {
        // Try to find the message in current chat
        let messagePreview = '[Message deleted]';
        let isDeleted = true;
        
        if (context && context.chat) {
            const message = context.chat.find(msg => msg.id === favItem.messageId);
            if (message) {
                // Truncate message to first 40 characters
                messagePreview = message.mes.substring(0, 40) + (message.mes.length > 40 ? '...' : '');
                isDeleted = false;
            }
        } else if (getCurrentChatId() !== favoritesPopup.chatId) {
            // If viewing favorites for a different chat
            messagePreview = '[Preview requires switching to the corresponding chat]';
        }
        
        // Format timestamp
        const formattedDate = timestampToMoment(favItem.timestamp).format('YYYY-MM-DD HH:mm');
        
        return `
            <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}">
                <div class="fav-meta">${favItem.sender} (${favItem.role}) - ${formattedDate}</div>
                <div class="fav-note" style="${favItem.note ? '' : 'display:none;'}">Note: ${favItem.note || ''}</div>
                <div class="fav-preview ${isDeleted ? 'deleted' : ''}">${messagePreview}</div>
                <div class="fav-actions">
                    <i class="fa-solid fa-pencil" title="Edit Note"></i>
                    <i class="fa-solid fa-trash" title="Delete Favorite"></i>
                </div>
            </div>
        `;
    } catch (error) {
        console.error(`${pluginName}: Error rendering favorite item:`, error);
        return '<div class="favorite-item error">Error rendering item</div>';
    }
}

// Handle edit note button click
function handleEditNote(event) {
    try {
        const itemElement = $(event.target).closest('.favorite-item');
        const favoriteId = itemElement.data('fav-id');
        const chatId = getCurrentChatId();
        
        if (!chatId || !favoriteId) {
            console.error(`${pluginName}: Missing chat ID or favorite ID for edit`);
            return;
        }
        
        const chat = extension_settings[pluginName].chats[chatId];
        if (!chat || !chat.items) {
            console.error(`${pluginName}: Chat or items not found for edit`);
            return;
        }
        
        // Find the item
        const item = chat.items.find(item => item.id === favoriteId);
        if (!item) {
            console.error(`${pluginName}: Favorite item not found for edit`);
            return;
        }
        
        // Show input dialog
        callGenericPopup(
            'Enter a note for this favorite:',
            POPUP_TYPE.INPUT,
            item.note || '',
            {
                rows: 3,
                okButton: 'Save'
            }
        ).then(result => {
            if (result.response == POPUP_RESULT.OK) {
                // Update note
                item.note = result.input.trim();
                saveSettingsDebounced();
                
                // Update UI
                updateFavoritesPopup(chatId);
            }
        });
        
    } catch (error) {
        console.error(`${pluginName}: Error handling edit note:`, error);
    }
}

// Handle delete favorite button click
function handleDeleteFavorite(event) {
    try {
        const itemElement = $(event.target).closest('.favorite-item');
        const favoriteId = itemElement.data('fav-id');
        const messageId = itemElement.data('msg-id');
        const chatId = getCurrentChatId();
        
        if (!chatId || !favoriteId) {
            console.error(`${pluginName}: Missing chat ID or favorite ID for delete`);
            return;
        }
        
        // Show confirmation dialog
        callGenericPopup(
            'Delete this favorite?',
            POPUP_TYPE.CONFIRM,
            null,
            {
                okButton: 'Delete'
            }
        ).then(result => {
            if (result.response == POPUP_RESULT.OK) {
                // Delete favorite
                removeFavoriteById(chatId, favoriteId);
            }
        });
        
    } catch (error) {
        console.error(`${pluginName}: Error handling delete favorite:`, error);
    }
}

// Handle clearing invalid favorites
function handleClearInvalidFavorites(chatId) {
    try {
        if (!chatId) {
            console.error(`${pluginName}: Missing chat ID for clearing invalid favorites`);
            return;
        }
        
        const chat = extension_settings[pluginName].chats[chatId];
        if (!chat || !chat.items) {
            console.error(`${pluginName}: Chat or items not found for clearing`);
            return;
        }
        
        const context = getContext();
        if (!context || !context.chat) {
            callGenericPopup('Cannot validate messages. Try refreshing the page.', POPUP_TYPE.ALERT);
            return;
        }
        
        // Find invalid items
        const validMessageIds = context.chat.map(msg => msg.id);
        const invalidItems = chat.items.filter(item => !validMessageIds.includes(item.messageId));
        
        if (invalidItems.length === 0) {
            callGenericPopup('No invalid favorites found.', POPUP_TYPE.ALERT);
            return;
        }
        
        // Show confirmation dialog
        callGenericPopup(
            `Found ${invalidItems.length} invalid favorites. Delete them?`,
            POPUP_TYPE.CONFIRM,
            null,
            {
                okButton: 'Delete'
            }
        ).then(result => {
            if (result.response == POPUP_RESULT.OK) {
                // Remove invalid items
                const initialCount = chat.items.length;
                chat.items = chat.items.filter(item => validMessageIds.includes(item.messageId));
                chat.count = chat.items.length;
                
                // If no items left, remove the chat entry
                if (chat.count === 0) {
                    delete extension_settings[pluginName].chats[chatId];
                }
                
                // Save settings
                saveSettingsDebounced();
                
                // Update UI
                updateFavoritesPopup(chatId);
                
                const removedCount = initialCount - chat.items.length;
                console.log(`${pluginName}: Removed ${removedCount} invalid favorites`);
            }
        });
        
    } catch (error) {
        console.error(`${pluginName}: Error clearing invalid favorites:`, error);
    }
}

// Handle pagination click
function handlePaginationClick(event) {
    const page = $(event.target).data('page');
    if (!page) return;
    
    favoritesPopup.currentPage = page;
    updateFavoritesPopup(getCurrentChatId());
}

// Render the all favorites view in settings
function renderAllFavoritesView() {
    try {
        const allChats = extension_settings[pluginName].chats;
        if (!allChats || Object.keys(allChats).length === 0) {
            $('#all-favorites-container').html('<div class="no-favorites">No favorites found in any chat.</div>');
            return;
        }
        
        // Group chats by character/group
        const groupedChats = {};
        
        Object.entries(allChats).forEach(([chatId, chatData]) => {
            const id = chatData.type === 'private' ? chatData.characterId : chatData.groupId;
            const type = chatData.type;
            const name = chatData.name;
            
            if (!groupedChats[type]) {
                groupedChats[type] = {};
            }
            
            if (!groupedChats[type][id]) {
                groupedChats[type][id] = {
                    name: name,
                    chats: []
                };
            }
            
            groupedChats[type][id].chats.push({
                chatId: chatId,
                name: name,
                count: chatData.count
            });
        });
        
        // Render groups
        let html = '';
        
        // First render private chats
        if (groupedChats.private) {
            Object.entries(groupedChats.private).forEach(([characterId, data]) => {
                html += `
                    <div class="character-group">
                        <div class="character-group-title">${data.name} (Character)</div>
                        <div class="chat-entries">
                            ${data.chats.map(chat => `
                                <div class="chat-entry-item" data-chat-id="${chat.chatId}">
                                    Chat: ${chat.name} (Favorites: ${chat.count})
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            });
        }
        
        // Then render group chats
        if (groupedChats.group) {
            Object.entries(groupedChats.group).forEach(([groupId, data]) => {
                html += `
                    <div class="character-group">
                        <div class="character-group-title">${data.name} (Group)</div>
                        <div class="chat-entries">
                            ${data.chats.map(chat => `
                                <div class="chat-entry-item" data-chat-id="${chat.chatId}">
                                    Chat: ${chat.name} (Favorites: ${chat.count})
                                </div>
                            `).join('')}
                        </div>
                    </div>
                `;
            });
        }
        
        $('#all-favorites-container').html(html);
        
        // Bind click event for chat entries (using event delegation)
        $('#all-favorites-container').off('click', '.chat-entry-item').on('click', '.chat-entry-item', function() {
            const clickedChatId = $(this).data('chat-id');
            if (clickedChatId) {
                if (favoritesPopup) {
                    favoritesPopup.chatId = clickedChatId;
                    favoritesPopup.currentPage = 1;
                    updateFavoritesPopup(clickedChatId);
                    favoritesPopup.show();
                } else {
                    // Create popup if it doesn't exist
                    favoritesPopup = new Popup('Favorites', 'favorites-popup-content', 'auto-height');
                    favoritesPopup.addCloseButton();
                    favoritesPopup.chatId = clickedChatId;
                    
                    // Add event delegation for popup actions
                    $(document).on('click', '#favorites-list-container .fa-pencil', handleEditNote);
                    $(document).on('click', '#favorites-list-container .fa-trash', handleDeleteFavorite);
                    $(document).on('click', '#clear-invalid-favorites', () => handleClearInvalidFavorites(clickedChatId));
                    $(document).on('click', '#favorites-pagination .page-item', handlePaginationClick);
                    
                    updateFavoritesPopup(clickedChatId);
                    favoritesPopup.show();
                }
            }
        });
        
    } catch (error) {
        console.error(`${pluginName}: Error rendering all favorites view:`, error);
        $('#all-favorites-container').html('<div class="error">Error loading favorites overview.</div>');
    }
}
