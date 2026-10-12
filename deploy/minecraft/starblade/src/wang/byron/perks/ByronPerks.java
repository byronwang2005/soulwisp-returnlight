package wang.byron.perks;

import java.util.UUID;
import net.minecraft.nbt.TagParser;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.EquipmentSlot;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.item.ItemStack;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.entity.living.LivingIncomingDamageEvent;
import net.neoforged.neoforge.event.entity.player.PlayerEvent;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.common.util.FakePlayer;
import net.neoforged.neoforge.common.damagesource.DamageContainer;
import com.mojang.authlib.GameProfile;
import net.minecraft.core.component.DataComponents;

@Mod("byron_perks")
public final class ByronPerks {
    private static final UUID BYRON = UUID.fromString("bc5a04f1-8559-471c-ad79-ce9b424e3884");
    public ByronPerks() {
        NeoForge.EVENT_BUS.addListener(ByronPerks::damage);
        Starblade.register();
        RailOps.register();
        NeoForge.EVENT_BUS.addListener(ByronPerks::login);
        NeoForge.EVENT_BUS.addListener(ByronPerks::selfTest);
        System.out.println("[ByronPerks] Loaded: UUID-scoped PvP immunity and one-time enchanted diamond armor.");
    }
    private static boolean protectedPlayer(Player p) { return BYRON.equals(p.getUUID()); }
    private static void selfTest(ServerStartedEvent event) {
        // Detached fake players: no world insertion, network connection, or real player save.
        var world=event.getServer().overworld();
        var target=new FakePlayer(world,new GameProfile(BYRON,"ByronPerksProbe"));
        var other=new FakePlayer(world,new GameProfile(UUID.fromString("f9eb5a58-d1e7-468b-98ec-b3d99e26f943"),"PerksAttacker"));
        var pvp=new LivingIncomingDamageEvent(target,new DamageContainer(world.damageSources().playerAttack(other),10f));
        NeoForge.EVENT_BUS.post(pvp);
        var fall=new LivingIncomingDamageEvent(target,new DamageContainer(world.damageSources().fall(),10f));
        NeoForge.EVENT_BUS.post(fall);
        var ordinary=new LivingIncomingDamageEvent(other,new DamageContainer(world.damageSources().playerAttack(target),10f));
        NeoForge.EVENT_BUS.post(ordinary);
        if (!pvp.isCanceled() || fall.isCanceled() || ordinary.isCanceled()) throw new IllegalStateException("PvP protection scope test failed");
        login(new PlayerEvent.PlayerLoggedInEvent(target));
        for (var slot:new EquipmentSlot[]{EquipmentSlot.HEAD,EquipmentSlot.CHEST,EquipmentSlot.LEGS,EquipmentSlot.FEET}) {
            var stack=target.getItemBySlot(slot);
            if (stack.isEmpty() || stack.get(DataComponents.ENCHANTMENTS).isEmpty()) throw new IllegalStateException("Starter armor test failed");
        }
        var original=target.getItemBySlot(EquipmentSlot.HEAD);
        login(new PlayerEvent.PlayerLoggedInEvent(target));
        if (target.getItemBySlot(EquipmentSlot.HEAD)!=original) throw new IllegalStateException("Repeated-login kit guard failed");
        System.out.println("[ByronPerks] SELFTEST PASS: player damage blocked; fall and other players unaffected; four enchanted armor items; one-time kit guard.");
    }
    private static void damage(LivingIncomingDamageEvent event) {
        if (event.getEntity() instanceof ServerPlayer p && protectedPlayer(p)
                && event.getSource().getEntity() instanceof Player) {
            event.setCanceled(true);
        }
    }
    private static void login(PlayerEvent.PlayerLoggedInEvent event) {
        if (!(event.getEntity() instanceof ServerPlayer p) || !protectedPlayer(p)) return;
        var persisted = p.getPersistentData().getCompound(Player.PERSISTED_NBT_TAG);
        if (persisted.getBoolean("ByronDiamondKitV1")) return;
        try {
            EquipmentSlot[] slots = {EquipmentSlot.HEAD, EquipmentSlot.CHEST, EquipmentSlot.LEGS, EquipmentSlot.FEET};
            String[] ids = {"diamond_helmet", "diamond_chestplate", "diamond_leggings", "diamond_boots"};
            ItemStack[] armor = new ItemStack[4];
            for (int i=0;i<4;i++) {
                String extra = i==0 ? ",\"minecraft:respiration\":3,\"minecraft:aqua_affinity\":1"
                    : i==3 ? ",\"minecraft:feather_falling\":4,\"minecraft:depth_strider\":3" : "";
                String nbt = "{id:\"minecraft:"+ids[i]+"\",count:1,components:{\"minecraft:enchantments\":{levels:{"
                    + "\"minecraft:protection\":4,\"minecraft:unbreaking\":3,\"minecraft:mending\":1"+extra+"}}}}";
                armor[i] = ItemStack.parseOptional(p.registryAccess(), TagParser.parseTag(nbt));
                if (armor[i].isEmpty()) throw new IllegalStateException("Could not parse armor: "+ids[i]);
            }
            for (int i=0;i<4;i++) {
                ItemStack old = p.getItemBySlot(slots[i]).copy();
                if (!old.isEmpty() && !p.getInventory().add(old)) p.drop(old, false);
                p.setItemSlot(slots[i],armor[i]);
            }
            persisted.putBoolean("ByronDiamondKitV1",true);
            p.getPersistentData().put(Player.PERSISTED_NBT_TAG,persisted);
            p.getInventory().setChanged();
            System.out.println("[ByronPerks] Equipped enchanted diamond armor for "+p.getGameProfile().getName());
        } catch (Exception ex) { throw new IllegalStateException("Byron starter armor failed",ex); }
    }
}
