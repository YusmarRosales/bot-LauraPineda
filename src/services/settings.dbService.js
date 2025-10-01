const Settings = require('../models/Settings');

async function isBotActive() {
  try{
    const settings = await Settings.findOne();
    return settings?.botActive || false;
  }catch(e){
    throw e;
  }  
}

async function setBotActive(active) {
  try {
    const s = await Settings.findOneAndUpdate(
      {},
      { $set: { botActive: !!active } },
      { new: true, upsert: true }
    ).lean();
    return !!s.botActive;
  } catch (e) { e.ctx = { where: 'settings.setBotActive', active }; throw e; }
}

module.exports = { 
  isBotActive,
  setBotActive,
 };