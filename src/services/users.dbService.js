const User = require('../models/Users');

async function findOrCreateUserByPhone(phone, { wpp_name } = {}) {
  try{
    const update = {};
    if (wpp_name) update.wpp_name = wpp_name;

    const user = await User.findOneAndUpdate(
      { phone },
      { $setOnInsert: { phone }, ...(Object.keys(update).length ? { $set: update } : {}) },
      { new: true, upsert: true, setDefaultsOnInsert: true}
    );

    return user;

  }catch(e){
    throw e;
  }
}

async function setUserThread(userId, threadId) {
  try{
    return User.findByIdAndUpdate(
      userId,
      { $set: { thread: threadId } },
      { new: true }
    );
  }catch(e){
    throw e;
  }
}

async function isUserBotEnabled(phone) {
  try{
    const user = await User.findOne({ phone }, { botEnabled: 1 });
    // Si no existe o no tiene el campo, lo consideramos habilitado.
    return user?.botEnabled !== false;
  }catch(e){
    throw e;
  }
}

async function setUserBotEnabled(phone, enabled) {
  try{
    return User.findOneAndUpdate(
      { phone },
      { $set: { botEnabled: !!enabled } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    ).lean();
  }catch(e){
    throw e;
  }
}

module.exports = {
  findOrCreateUserByPhone,
  setUserThread,
  isUserBotEnabled,
  setUserBotEnabled,
};