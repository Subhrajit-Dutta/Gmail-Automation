// Import required modules and set up the Express application
const express = require("express");
const app = express();
const path = require("path");
const { authenticate } = require("@google-cloud/local-auth");
const fs = require("fs").promises;
const { google } = require("googleapis");

const port = 3000;

const SCOPES = [
  "https://www.googleapis.com/auth/gmail.readonly",
  "https://www.googleapis.com/auth/gmail.send",
  "https://www.googleapis.com/auth/gmail.labels",
  "https://mail.google.com/",
];

const labelName = "Auto_Reply";

// Define a route for the root URL ("/")
app.get("/", async (req, res) => {
  // Authenticate with Google using provided credentials
  const auth = await authenticate({
    keyfilePath: path.join(__dirname, "credentials.json"),
    scopes: SCOPES,
  });

  console.log("This is auth", auth);

  const gmail = google.gmail({ version: "v1", auth });

  // Get the list of labels from the user's Gmail account
  const response = await gmail.users.labels.list({
    userId: "me",
  });

  // Function to get unread messages from the inbox
  async function getUnrepliedMessages(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    const response = await gmail.users.messages.list({
      userId: "me",
      labelIds: ["INBOX"],
      q: "is:unread",
    });

    return response.data.messages || [];
  }

  // Function to create a custom label for auto-replied emails
  async function createLabel(auth) {
    const gmail = google.gmail({ version: "v1", auth });
    try {
      const response = await gmail.users.labels.create({
        userId: "me",
        requestBody: {
          name: labelName,
          labelListVisibility: "labelShow",
          messageListVisibility: "show",
        },
      });
      return response.data.id;
    } catch (error) {
      if (error.code === 409) {
        const response = await gmail.users.labels.list({
          userId: "me",
        });
        const label = response.data.labels.find(
          (label) => label.name === labelName
        );
        return label.id;
      } else {
        throw error;
      }
    }
  }

  // Main function that periodically checks for unreplied messages and sends auto-replies
  async function main() {
    const labelId = await createLabel(auth);
    setInterval(async () => {
      const messages = await getUnrepliedMessages(auth);

      if (messages && messages.length > 0) {
        for (const message of messages) {
          const messageData = await gmail.users.messages.get({
            auth,
            userId: "me",
            id: message.id,
          });

          const email = messageData.data;
          const hasReplied = email.payload.headers.some(
            (header) => header.name === "In-Reply-To"
          );

          if (!hasReplied) {
            // Compose and send an auto-reply message
            const replyMessage = {
              userId: "me",
              resource: {
                raw: Buffer.from(
                  `To: ${
                    email.payload.headers.find(
                      (header) => header.name === "From"
                    ).value
                  }\r\n` +
                    `Subject: Re: ${
                      email.payload.headers.find(
                        (header) => header.name === "Subject"
                      ).value
                    }\r\n` +
                    `Content-Type: text/plain; charset="UTF-8"\r\n` +
                    `Content-Transfer-Encoding: 7bit\r\n\r\n` +
                    `Thanks for the mail. Subhrajit is currently busy. He will get back to you as soon as possible.\r\n`
                ).toString("base64"),
              },
            };

            await gmail.users.messages.send(replyMessage);

            // Move the replied message to the custom label and remove it from the inbox
            await gmail.users.messages.modify({
              auth,
              userId: "me",
              id: message.id,
              resource: {
                addLabelIds: [labelId],
                removeLabelIds: ["INBOX"],
              },
            });
          }
        }
      }
    }, Math.floor(Math.random() * (120 - 45 + 1) + 45) * 1000); // Set a random interval for checking messages
  }

  // Call the main function and respond with a JSON indicating successful authentication
  main();
  res.json({ "this is Auth": auth });
});

// Start the Express server
app.listen(port, () => {
  console.log(`Server is running at http://localhost:${port}/`);
});
