package wang.byron.perks;
import java.util.*;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.player.Player;
import net.minecraft.world.inventory.*;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/** Each recipient owns an independent persistent ledger; both share one visual budget. */
public final class Starblade {
 public static final UUID OWNER=UUID.fromString("bc5a04f1-8559-471c-ad79-ce9b424e3884");
 public static final UUID HEARTH=UUID.fromString("0300f9c6-01b3-41d4-9605-5f9448d33c08");
 private static final List<StarbladeEngine> engines=List.of(
  new StarbladeEngine(OWNER,"ByronNomad","starblade","byron_starblade","",false),
  new StarbladeEngine(HEARTH,"H3arth","hearthblade","hearth_starblade"," · 来自父亲的礼物",true));
 private static long budgetTick=-1;private static int budget;
 public static void register(){
  NeoForge.EVENT_BUS.addListener(Starblade::started);
  NeoForge.EVENT_BUS.addListener(GearAura::xp);
  for(var engine:engines)engine.register();
  NeoForge.EVENT_BUS.addListener(Starblade::tick);
 }
 private static void started(ServerStartedEvent e){GearAura.initialize(e.getServer());}
 private static void tick(ServerTickEvent.Post e){for(var p:e.getServer().getPlayerList().getPlayers())GearAura.update(p);}
 public static boolean consumeParticle(long tick){if(budgetTick!=tick){budgetTick=tick;budget=64;}return budget-->0;}
 public static boolean marked(ItemStack s){var data=s.get(net.minecraft.core.component.DataComponents.CUSTOM_DATA);return data!=null&&data.copyTag().contains("starblade");}
 public static boolean wield(ServerPlayer p){return engines.stream().anyMatch(e->e.wield(p));}
 public static boolean silkMode(ServerPlayer p){return engines.stream().anyMatch(e->e.OWNER.equals(p.getUUID())&&e.silkMode());}
 public static boolean frostMode(ServerPlayer p){return engines.stream().anyMatch(e->e.OWNER.equals(p.getUUID())&&e.frostMode());}
 public static boolean automationAllowed(ItemStack s){return engines.stream().anyMatch(e->e.marked(s)&&e.automationAllowed());}
 public static boolean menuBefore(AbstractContainerMenu m,int slot,int button,ClickType type,Player p){
  boolean allow=true;for(var e:engines)if(!e.menuBefore(m,slot,button,type,p))allow=false;return allow;
 }
 public static void menuAfter(AbstractContainerMenu m,Player p){for(var e:engines)e.menuAfter(m,p);}
 public static void closing(AbstractContainerMenu m,Player p){for(var e:engines)if(e.marked(m.getCarried())){e.closing(m,p);break;}}
}
