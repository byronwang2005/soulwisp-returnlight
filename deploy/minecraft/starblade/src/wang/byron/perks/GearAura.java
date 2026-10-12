package wang.byron.perks;

import java.util.*;
import net.minecraft.core.component.DataComponents;
import net.minecraft.nbt.TagParser;
import net.minecraft.resources.ResourceLocation;
import net.minecraft.server.MinecraftServer;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.entity.*;
import net.minecraft.world.entity.ai.attributes.*;
import net.minecraft.world.item.*;
import net.minecraft.world.item.enchantment.*;

/** Virtual enchantments use vanilla effect processing; equipped items are never overwritten. */
public final class GearAura {
    private static final EnumMap<EquipmentSlot,ItemStack> armor=new EnumMap<>(EquipmentSlot.class);
    private static ItemStack frozenBoots,fortuneWeapon,silkWeapon;
    public static final ThreadLocal<Boolean> ACTUAL=ThreadLocal.withInitial(()->false);
    private static final Map<UUID,Map<net.minecraft.core.Holder<Attribute>,Set<ResourceLocation>>> applied=new HashMap<>();
    private static final Set<UUID> enhanced=new HashSet<>();
    private static final ResourceLocation AURA=ResourceLocation.fromNamespaceAndPath("byron_perks","starblade_aura");
    private static final Map<net.minecraft.core.Holder<Attribute>,Double> FLOORS=Map.of(Attributes.ARMOR,20d,Attributes.ARMOR_TOUGHNESS,8d);
    public static void initialize(MinecraftServer server){
        armor.clear();enhanced.clear();applied.clear();
        String common="\"minecraft:protection\":4,\"minecraft:fire_protection\":4,\"minecraft:blast_protection\":4,\"minecraft:projectile_protection\":4,\"minecraft:thorns\":3,\"minecraft:unbreaking\":3,\"minecraft:mending\":1";
        armor.put(EquipmentSlot.HEAD,parse(server,"diamond_helmet",common+",\"minecraft:respiration\":3,\"minecraft:aqua_affinity\":1",null));
        armor.put(EquipmentSlot.CHEST,parse(server,"diamond_chestplate",common,null));
        armor.put(EquipmentSlot.LEGS,parse(server,"diamond_leggings",common+",\"minecraft:swift_sneak\":3",null));
        armor.put(EquipmentSlot.FEET,parse(server,"diamond_boots",common+",\"minecraft:feather_falling\":4,\"minecraft:depth_strider\":3,\"minecraft:soul_speed\":3",null));
        frozenBoots=parse(server,"diamond_boots",common+",\"minecraft:feather_falling\":4,\"minecraft:frost_walker\":2,\"minecraft:soul_speed\":3",null);
        String sword="\"minecraft:sharpness\":5,\"minecraft:smite\":5,\"minecraft:bane_of_arthropods\":5,\"minecraft:knockback\":2,\"minecraft:fire_aspect\":2,\"minecraft:looting\":3,\"minecraft:sweeping_edge\":3,\"minecraft:efficiency\":5,\"minecraft:unbreaking\":3,\"minecraft:mending\":1";
        String tool="{rules:[{blocks:\"#minecraft:incorrect_for_diamond_tool\",correct_for_drops:false},{blocks:\"#minecraft:mineable/pickaxe\",speed:8.0f,correct_for_drops:true},{blocks:\"#minecraft:mineable/axe\",speed:8.0f,correct_for_drops:true},{blocks:\"#minecraft:mineable/shovel\",speed:8.0f,correct_for_drops:true},{blocks:\"#minecraft:mineable/hoe\",speed:8.0f,correct_for_drops:true}],default_mining_speed:1.0f,damage_per_block:0}";
        fortuneWeapon=parse(server,"netherite_sword",sword+",\"minecraft:fortune\":3",tool);
        silkWeapon=parse(server,"netherite_sword",sword+",\"minecraft:silk_touch\":1",tool);
    }
    private static ItemStack parse(MinecraftServer server,String id,String enchants,String tool){
        try{
            var stack=ItemStack.parseOptional(server.registryAccess(),TagParser.parseTag("{id:\"minecraft:"+id+"\",count:1,components:{\"minecraft:unbreakable\":{},\"minecraft:enchantments\":{levels:{"+enchants+"}}"+(tool==null?"":",\"minecraft:tool\":"+tool)+"}}"));
            if(stack.isEmpty())throw new IllegalStateException("Empty virtual equipment: "+id);return stack;
        }catch(Exception ex){throw new IllegalStateException("Virtual equipment parse: "+id,ex);}
    }
    public static void enchantWeapon(ItemStack weapon,boolean silk){
        var preset=silk?silkWeapon:fortuneWeapon;
        if(preset==null)throw new IllegalStateException("Aura presets not initialized");
        if(!Objects.equals(weapon.get(DataComponents.ENCHANTMENTS),preset.get(DataComponents.ENCHANTMENTS)))weapon.set(DataComponents.ENCHANTMENTS,preset.get(DataComponents.ENCHANTMENTS));
        if(!Objects.equals(weapon.get(DataComponents.TOOL),preset.get(DataComponents.TOOL)))weapon.set(DataComponents.TOOL,preset.get(DataComponents.TOOL));
    }
    public static ItemStack equipment(LivingEntity entity,EquipmentSlot slot,ItemStack actual){
        if(ACTUAL.get()||!(entity instanceof ServerPlayer p)||!Starblade.wield(p)||!armor.containsKey(slot))return actual;
        var preset=slot==EquipmentSlot.FEET&&Starblade.frostMode(p)?frozenBoots:armor.get(slot);
        var copy=actual.isEmpty()?preset.copy():actual.copy();
        var enchantments=preset.get(DataComponents.ENCHANTMENTS);
        EnchantmentHelper.updateEnchantments(copy,mutable->{for(var entry:enchantments.entrySet())mutable.upgrade(entry.getKey(),entry.getIntValue());});
        copy.set(DataComponents.UNBREAKABLE,preset.get(DataComponents.UNBREAKABLE));return copy;
    }
    public static void xp(net.neoforged.neoforge.event.entity.player.PlayerXpEvent.XpChange event){
        if(!(event.getEntity() instanceof ServerPlayer p)||!Starblade.wield(p)||event.getAmount()<=0)return;
        int remaining=event.getAmount();
        for(var item:p.getAllSlots())if(item.isDamaged()&&remaining>0){int repair=Math.min(item.getDamageValue(),remaining*2);item.setDamageValue(item.getDamageValue()-repair);remaining-=(repair+1)/2;}
        event.setAmount(remaining);
    }
    public static Integer durability(net.minecraft.server.level.ServerLevel level,ItemStack actual,int damage){
        if(ACTUAL.get())return null;
        for(var owner:level.getServer().getPlayerList().getPlayers())if(Starblade.wield(owner)){
        for(var slot:armor.keySet())if(owner.getItemBySlot(slot)==actual){
            var shadow=equipment(owner,slot,actual);ACTUAL.set(true);
            try{return EnchantmentHelper.processDurabilityChange(level,shadow,damage);}finally{ACTUAL.set(false);}
        }}return null;
    }
    public static void update(ServerPlayer p){
        boolean active=Starblade.wield(p);
        if(active)enchantWeapon(p.getMainHandItem(),Starblade.silkMode(p));
        for(var entry:FLOORS.entrySet()){
            var attr=p.getAttribute(entry.getKey());if(attr==null)continue;var old=attr.getModifier(AURA);
            double target=active?entry.getValue():0;
            if(entry.getKey()==Attributes.WATER_MOVEMENT_EFFICIENCY&&Starblade.frostMode(p))target=0;
            double without=attr.getValue()-(old==null?0:old.amount());double amount=active?Math.max(0,target-without):0;
            if(old!=null&&Math.abs(old.amount()-amount)<1e-7)continue;
            if(old!=null)attr.removeModifier(AURA);
            if(amount>1e-7)attr.addTransientModifier(new AttributeModifier(AURA,amount,AttributeModifier.Operation.ADD_VALUE));
        }
        var wanted=new HashMap<net.minecraft.core.Holder<Attribute>,Set<ResourceLocation>>();
        if(active)for(var entry:armor.entrySet()){
            var virtual=equipment(p,entry.getKey(),p.getItemBySlot(entry.getKey()));
            EnchantmentHelper.forEachModifier(virtual,entry.getKey(),(holder,modifier)->{
                var attr=p.getAttribute(holder);if(attr==null)return;
                var id=ResourceLocation.fromNamespaceAndPath("byron_perks","aura/"+modifier.id().getNamespace()+"/"+modifier.id().getPath());
                var original=attr.getModifier(modifier.id());double amount=modifier.amount()-(original==null?0:original.amount());
                if(Math.abs(amount)<1e-7)return;wanted.computeIfAbsent(holder,k->new HashSet<>()).add(id);
                var current=attr.getModifier(id);if(current!=null&&Math.abs(current.amount()-amount)<1e-7)return;
                if(current!=null)attr.removeModifier(id);attr.addTransientModifier(new AttributeModifier(id,amount,modifier.operation()));
            });
        }
        var previous=applied.get(p.getUUID());if(previous!=null)for(var entry:previous.entrySet())for(var id:entry.getValue())if(!wanted.getOrDefault(entry.getKey(),Set.of()).contains(id)){var attr=p.getAttribute(entry.getKey());if(attr!=null)attr.removeModifier(id);}
        if(wanted.isEmpty())applied.remove(p.getUUID());else applied.put(p.getUUID(),wanted);
        if(active)enhanced.add(p.getUUID());
        else if(enhanced.remove(p.getUUID())){
            for(var entry:armor.entrySet())EnchantmentHelper.stopLocationBasedEffects(entry.getValue(),p,entry.getKey());
            EnchantmentHelper.stopLocationBasedEffects(frozenBoots,p,EquipmentSlot.FEET);
            EnchantmentHelper.runLocationChangedEffects(p.serverLevel(),p);
        }
    }
}
