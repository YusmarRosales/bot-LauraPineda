const Message = require('../models/Messages');

async function createIncomingMessage({ userId, phone, type = 'text', text = null, caption = null, threadId = null, media = null}) {
  try{
    const doc = await Message.create({
      user: userId,
      phone,
      type,
      text,
      caption,
      status: 'pending',
      threadId,
      media,
    });
    return doc;
  }catch(e){
    console.error("Error en createIncomingMessage: ", e.message)
    throw e;
  }
}

async function setMessageResponse(messageId, responseText, { status = 'answered' } = {}) {
  try{
  return Message.findByIdAndUpdate(
    messageId,
    {
      $set: {
        assistantResponse: responseText,
        status,
      },
    },
    { new: true }
  );
  } catch(e){
    console.error("Error en setMessageResponse: ", e.message)
    throw e;
  }
}

async function setMessageStatus(messageId, status) {
  try{
    return Message.findByIdAndUpdate(messageId, { $set: { status } }, { new: true });
  }catch(e){
    console.error("Error en setMessageStatus: ", e.message)
    throw e;
  }
}

async function setMessageRunMeta(messageId, { runId, runStatus, runError, runUsage }) {
  try{
    return Message.findByIdAndUpdate(
      messageId,
      { $set: { runId, runStatus, runError, runUsage } },
      { new: true }
    );
  } catch(e){
    console.error("Error en setMessageRunMeta: ", e.message)
    throw e;
  }
}

async function setMessageMediaOpenAI(messageId, { openaiFileId, openaiPurpose = 'vision' }) {
  try{
    return Message.findByIdAndUpdate(
      messageId,
      { $set: { 'media.openaiFileId': openaiFileId, 'media.openaiPurpose': openaiPurpose } },
      { new: true }
    );
  }catch(e){
    console.error("Error en setMessageMediaOpenAI: ", e.message)
    throw e;
  }
}

async function setMessageRunMeta(messageId, { runId, runStatus, runError, runUsage }) {
  try{
    return Message.findByIdAndUpdate(
      messageId,
      { $set: { runId, runStatus, runError, runUsage } },
      { new: true }
    );
  }catch(e){
    console.error("Error en setMessageRunMeta: ", e.message)
    throw e;
  }
}

module.exports = {
  createIncomingMessage,
  setMessageResponse,
  setMessageStatus,
  setMessageRunMeta,
  setMessageMediaOpenAI,
};