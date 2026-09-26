import { world, system } from "@minecraft/server";
import { ActionFormData } from "@minecraft/server-ui";

const states = new Map();
const COMBO_WINDOW = 52;
const STIFF = { light1: 12, light2: 13, light3: 16, heavy: 20 };
const BLOCK_TICKS = 20;
const DASH_COOLDOWN = 14;
const DODGE_COOLDOWN = 18;
const POPUP_TICKS = 14;

const ANIM = {
  light1: "animation.bb.combat.light1",
  light2: "animation.bb.combat.light2",
  light3: "animation.bb.combat.light3",
  heavy: "animation.bb.combat.heavy",
  dash: "animation.bb.combat.dash",
  dodge: "animation.bb.combat.dodge"
};

function state(player) {
  let s = states.get(player.id);
  if (!s) {
    s = { combo: 0, lastSwing: -9999, stiffUntil: 0, blockUntil: 0, dashUntil: 0, dodgeUntil: 0 };
    states.set(player.id, s);
  }
  return s;
}

function heldSword(player) {
  try {
    const item = player.getComponent("minecraft:equippable")?.getEquipment("Mainhand");
    return item?.typeId === "bb:battle_sword";
  } catch { return false; }
}

function msg(player, text) {
  try { player.onScreenDisplay.setActionBar(text); } catch {}
}

function playCombatAnim(player, key) {
  const name = ANIM[key];
  if (!name) return false;
  try {
    player.playAnimation(name, { blendOutTime: 0.18 });
    return true;
  } catch {
    try { player.playAnimation(name); return true; } catch { return false; }
  }
}

function nextCombo(player) {
  const s = state(player);
  const now = system.currentTick;
  if (now - s.lastSwing > COMBO_WINDOW) s.combo = 0;
  s.combo = (s.combo % 3) + 1;
  s.lastSwing = now;
  return s.combo;
}

function spawnSlash(dim, loc) {
  try {
    dim.spawnParticle("bb:slash_hit", { x: loc.x, y: loc.y + 1.0, z: loc.z });
  } catch {}
}

function spawnDamagePopup(target, amount) {
  try {
    const loc = target.location;
    const popup = target.dimension.spawnEntity("minecraft:armor_stand", {
      x: loc.x, y: loc.y + 1.45, z: loc.z
    });
    popup.nameTag = String(amount);
    try { popup.addEffect("invisibility", POPUP_TICKS, { amplifier: 0, showParticles: false }); } catch {}
    try { popup.addEffect("resistance", POPUP_TICKS, { amplifier: 255, showParticles: false }); } catch {}
    system.runTimeout(() => { try { popup.remove(); } catch {} }, POPUP_TICKS);
  } catch {}
}

function openGuide(player) {
  const form = new ActionFormData()
    .title("Blade & Battle v0.9.6")
    .body("Combate\n\n• Light 1/2/3: click\n• Heavy: sneak + click\n• Block: usar espada\n• DASH: sprint\n• DODGE: salto + dirección de movimiento\n• Números flotantes: daño aplicado")
    .button("Cerrar");
  form.show(player);
}

function dodgeImpulse(player) {
  try {
    const input = player.inputInfo?.getMovementVector();
    if (input) {
      const x = input.x, z = input.y;
      const len = Math.hypot(x, z);
      if (len > 0.1) {
        const forward = player.getViewDirection();
        const fl = Math.hypot(forward.x, forward.z) || 1;
        const fux = forward.x / fl, fuz = forward.z / fl;
        const rux = -fuz, ruz = fux;
        const nx = (fux * z + rux * x) / len;
        const nz = (fuz * z + ruz * x) / len;
        player.applyImpulse({ x: nx * 0.58, y: 0.12, z: nz * 0.58 });
        return;
      }
    }
  } catch {}
  try {
    const d = player.getViewDirection();
    player.applyImpulse({ x: d.x * 0.58, y: 0.12, z: d.z * 0.58 });
  } catch {}
}

world.afterEvents.playerSwingStart?.subscribe?.((ev) => {
  const player = ev.player;
  if (!player || !heldSword(player) || ev.swingSource !== "Attack") return;
  const s = state(player), now = system.currentTick;
  if (now < s.stiffUntil) { msg(player, "§7…recovery"); return; }

  if (player.isSneaking) {
    s.combo = 0; s.lastSwing = now; s.stiffUntil = now + STIFF.heavy;
    const ok = playCombatAnim(player, "heavy");
    msg(player, ok ? "§aANIMATION PIPELINE §fHEAVY" : "§cHEAVY (anim fail)");
    system.runTimeout(() => {
      try {
        const loc = player.location, d = player.getViewDirection();
        spawnSlash(player.dimension, {x: loc.x+d.x*1.3, y: loc.y+1.15, z: loc.z+d.z*1.3});
      } catch {}
    }, 9);
  } else {
    const combo = nextCombo(player), key = `light${combo}`;
    s.stiffUntil = now + (STIFF[key] || 13);
    const ok = playCombatAnim(player, key);
    msg(player, ok ? `§aANIMATION PIPELINE §fLIGHT ${combo}` : `§cLIGHT ${combo} (anim fail)`);
    const delay = combo === 1 ? 4 : 5;
    system.runTimeout(() => {
      try {
        const loc = player.location, d = player.getViewDirection();
        spawnSlash(player.dimension, {x: loc.x+d.x*1.2, y: loc.y+1.1, z: loc.z+d.z*1.2});
      } catch {}
    }, delay);
  }
});

world.afterEvents.entityHitEntity.subscribe((ev) => {
  const p = ev.damagingEntity;
  if (!p || p.typeId !== "minecraft:player" || !heldSword(p)) return;
  const target = ev.hitEntity;
  if (!target?.isValid) return;

  spawnSlash(target.dimension, target.location);
  const s = state(p);

  if (p.isSneaking) {
    try { target.applyDamage(9); } catch {}
    spawnDamagePopup(target, 9);
    msg(p, "§cHEAVY — +9 extra");
    return;
  }

  const combo = s.combo || 1;
  const extra = [5, 6, 7][Math.max(0, Math.min(2, combo - 1))];
  try { target.applyDamage(extra); } catch {}
  spawnDamagePopup(target, extra);
  msg(p, `§eLIGHT ${combo} — +${extra} extra`);
});

world.afterEvents.itemUse.subscribe((ev) => {
  const p = ev.source;
  if (!p || p.typeId !== "minecraft:player") return;
  if (ev.itemStack?.typeId === "bb:combat_guide") return openGuide(p);
  if (ev.itemStack?.typeId === "bb:battle_sword") {
    state(p).blockUntil = system.currentTick + BLOCK_TICKS;
    msg(p, "§bBLOCK — 20 ticks");
  }
});

system.runInterval(() => {
  for (const p of world.getAllPlayers()) {
    const s = state(p);
    if (!heldSword(p)) continue;
    const now = system.currentTick;

    if (p.isSprinting && now >= s.dashUntil) {
      const d = p.getViewDirection();
      try { p.applyImpulse({x:d.x*0.65, y:0.05, z:d.z*0.65}); } catch {}
      playCombatAnim(p, "dash");
      s.dashUntil = now + DASH_COOLDOWN;
      msg(p, "§aANIMATION PIPELINE §fDASH");
    }

    let vy = 0;
    try { vy = p.getVelocity().y; } catch {}
    if (p.isSneaking && vy > 0.2 && now >= s.dodgeUntil) {
      dodgeImpulse(p);
      playCombatAnim(p, "dodge");
      s.dodgeUntil = now + DODGE_COOLDOWN;
      msg(p, "§aANIMATION PIPELINE §fDODGE");
    }
    if (s.blockUntil > 0 && now >= s.blockUntil) s.blockUntil = 0;
  }
}, 1);

world.afterEvents.playerSpawn.subscribe((ev) => {
  if (!ev.initialSpawn) return;
  system.runTimeout(() => msg(ev.player, "§eBlade & Battle v0.9.6 — Camera + Weapon + Dodge."), 20);
});
