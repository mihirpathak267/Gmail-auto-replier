require('dotenv').config()
const fs = require('fs').promises;
const path = require('path');
const process = require('process');
const {authenticate} = require('@google-cloud/local-auth');
const {google} = require('googleapis');



// If modifying these scopes, delete token.json.
const SCOPES = [
    'https://www.googleapis.com/auth/gmail.readonly',
    'https://www.googleapis.com/auth/gmail.modify',
    'https://www.googleapis.com/auth/gmail.metadata'
    
];
// The file token.json stores the user's access and refresh tokens, and is
// created automatically when the authorization flow completes for the first
// time.
const TOKEN_PATH = path.join(process.cwd(), 'token.json');
const CREDENTIALS_PATH = path.join(process.cwd(), 'credentials.json');

/**
 * Reads previously authorized credentials from the save file.
 *
 * @return {Promise<OAuth2Client|null>}
 */
async function loadSavedCredentialsIfExist() {
  try {
    const content = await fs.readFile(TOKEN_PATH);
    const credentials = JSON.parse(content);
    return google.auth.fromJSON(credentials);
  } catch (err) {
    return null;
  }
}

/**
 * Serializes credentials to a file compatible with GoogleAUth.fromJSON.
 *
 * @param {OAuth2Client} client
 * @return {Promise<void>}
 */
async function saveCredentials(client) {
  const content = await fs.readFile(CREDENTIALS_PATH);
  const keys = JSON.parse(content);
  const key = keys.installed || keys.web;
  const payload = JSON.stringify({
    type: 'authorized_user',
    client_id: key.client_id,
    client_secret: key.client_secret,
    refresh_token: client.credentials.refresh_token,
  });
  await fs.writeFile(TOKEN_PATH, payload);
}

/**
 * Load or request or authorization to call APIs.
 *
 */
async function authorize() {
  let client = await loadSavedCredentialsIfExist();
  if (client) {
    return client;
  }
  client = await authenticate({
    scopes: SCOPES,
    keyfilePath: CREDENTIALS_PATH,
  });
  if (client.credentials) {
    await saveCredentials(client);
  }
  return client;
}






const MIN_INTERVAL = 45000; // 45 seconds
const MAX_INTERVAL = 120000; // 120 seconds
async function autoReplyToUnreadEmails(auth) {
    const gmail = google.gmail({version: 'v1', auth})
    try {
      // Get all emails
      const response = await gmail.users.messages.list({
        userId: 'me'
      });
  
      const messages = response.data.messages;
      if (!messages || messages.length === 0) {
        console.log('No emails found.');
        return;
      }
  
      const currentDate = new Date();
  
      for (const message of messages) {
        const messageResponse = await gmail.users.messages.get({
          userId: 'me',
          id: message.id,
          format: 'metadata'
        });
  
        const email = messageResponse.data;
        const threadId = email.threadId;
  
        // Check if the email is unread and newer than today
        const isUnread = email.labelIds.includes('UNREAD');
        const emailDate = new Date(Number(email.internalDate));
  
        if (isUnread && isToday(emailDate, currentDate)) {
          // Check if the email thread has no prior reply
          const threadResponse = await gmail.users.threads.get({
            userId: 'me',
            id: threadId,
            format: 'metadata'
          });
  
          const thread = threadResponse.data;
          const hasPriorReply = thread.messages.some(msg => msg.labelIds.includes('SENT'));
  
          if (!hasPriorReply) {
            const senderEmail = getEmailAddress(email);
  
            // Compose your reply message content here
            const replyMessage = {
              threadId: threadId,
              to: senderEmail,
              message: 'I am on vacation'
            };
  
            // Send the reply email
            await gmail.users.messages.send({
              userId: 'me',
              requestBody: {
                threadId: replyMessage.threadId,
                raw: createReplyMessage(replyMessage, email)
              }
            });
  
            console.log('Reply sent for email with threadId:', threadId);
  
            // Move the email thread to the specified label
            const labelId = await createOrGetLabelId('On Vacation', auth);
            await gmail.users.threads.modify({
              userId: 'me',
              id: threadId,
              requestBody: {
                addLabelIds: [labelId]
              }
            });
  
            console.log('Email thread moved to the "On Vacation" label.');
          }
        }
      }
  
      // Schedule the next automatic check
      const interval = Math.floor(Math.random() * (MAX_INTERVAL - MIN_INTERVAL + 1)) + MIN_INTERVAL;
      setTimeout(autoReplyToUnreadEmails, interval);
    } catch (error) {
      console.error('An error occurred:', error.message);
      // Retry after an error occurs
      setTimeout(autoReplyToUnreadEmails, MIN_INTERVAL);
    }
  }
  
  async function createOrGetLabelId(labelName, auth) {
    const gmail = google.gmail({version: 'v1', auth})
    const response = await gmail.users.labels.list({
      userId: 'me'
    });
  
    const labels = response.data.labels;
    const existingLabel = labels.find(label => label.name === labelName);
  
    if (existingLabel) {
      return existingLabel.id;
    } else {
      const createResponse = await gmail.users.labels.create({
        userId: 'me',
        requestBody: {
          name: labelName,
          labelListVisibility: 'labelShow',
          messageListVisibility: 'show'
        }
      });
  
      return createResponse.data.id;
    }
  }
  
  function createReplyMessage({ threadId, to, message }, originalEmail) {
    const headers = originalEmail.payload.headers;
    const replyHeaders = headers.filter(header => ['From', 'Date', 'Subject', 'Message-ID'].includes(header.name));
  
    const replyEmail = [
      `To: ${to}`,
      `In-Reply-To: ${headers.find(h => h.name === 'Message-ID').value}`,
      `References: ${headers.find(h => h.name === 'Message-ID').value}`,
      ...replyHeaders.map(header => `${header.name}: ${header.value}`),
      'Content-Type: text/plain; charset="UTF-8"',
      'MIME-Version: 1.0',
      '',
      message
    ].join('\r\n');
  
    return Buffer.from(replyEmail).toString('base64').replace(/\+/g, '-').replace(/\//g, '_');
  }
  
  function getEmailAddress(email) {
    const fromHeader = email.payload.headers.find(h => h.name === 'From').value;
    const match = fromHeader.match(/<(.*?)>/);
  
    if (match && match[1]) {
      return match[1];
    }
  
    return fromHeader;
  }
  
  function isToday(date, currentDate) {
    return (
      date.getDate() === currentDate.getDate() &&
      date.getMonth() === currentDate.getMonth() &&
      date.getFullYear() === currentDate.getFullYear()
    );
  }
  
  
  // Start the automatic checking
  authorize().then(autoReplyToUnreadEmails).catch(console.error)
