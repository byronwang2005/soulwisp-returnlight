package wang.byron.perks.mixin;
import wang.byron.perks.GearAura;
import net.minecraft.world.entity.*;
import net.minecraft.world.item.ItemStack;
import net.minecraft.world.item.enchantment.EnchantmentHelper;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
import net.minecraft.core.component.DataComponentType;
import net.minecraft.world.item.enchantment.EnchantmentEffectComponents;
import net.minecraft.world.item.enchantment.EnchantedItemInUse;
import java.util.Optional;
import java.util.function.Predicate;
import org.spongepowered.asm.mixin.injection.*;
@Mixin(value=EnchantmentHelper.class,remap=false)
public abstract class EnchantmentEquipmentMixin {
 @Redirect(method="runIterationOnEquipment",at=@At(value="INVOKE",target="Lnet/minecraft/world/entity/LivingEntity;getItemBySlot(Lnet/minecraft/world/entity/EquipmentSlot;)Lnet/minecraft/world/item/ItemStack;"))
 private static ItemStack virtualArmor(LivingEntity entity,EquipmentSlot slot){return GearAura.equipment(entity,slot,entity.getItemBySlot(slot));}
 @Inject(method="getRandomItemWith",at=@At("HEAD"))
 private static void repairActual(DataComponentType<?> type,LivingEntity entity,Predicate<ItemStack> predicate,CallbackInfoReturnable<Optional<EnchantedItemInUse>> ci){if(type==EnchantmentEffectComponents.REPAIR_WITH_XP)GearAura.ACTUAL.set(true);}
 @Inject(method="getRandomItemWith",at=@At("RETURN"))
 private static void repairDone(DataComponentType<?> type,LivingEntity entity,Predicate<ItemStack> predicate,CallbackInfoReturnable<Optional<EnchantedItemInUse>> ci){GearAura.ACTUAL.set(false);}
 @Inject(method="processDurabilityChange",at=@At("HEAD"),cancellable=true)
 private static void armorDurability(net.minecraft.server.level.ServerLevel level,ItemStack item,int damage,CallbackInfoReturnable<Integer> ci){var result=GearAura.durability(level,item,damage);if(result!=null)ci.setReturnValue(result);}
}
