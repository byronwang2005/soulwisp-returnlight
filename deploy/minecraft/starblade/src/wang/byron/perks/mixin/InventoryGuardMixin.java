package wang.byron.perks.mixin;
import wang.byron.perks.Starblade;
import net.minecraft.world.item.ItemStack;
import net.neoforged.neoforge.items.wrapper.InvWrapper;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
@Mixin(value=InvWrapper.class,remap=false)
public abstract class InventoryGuardMixin {
 @Inject(method="extractItem",at=@At("HEAD"),cancellable=true)
 private void extract(int slot,int amount,boolean simulate,CallbackInfoReturnable<ItemStack> ci){if(Starblade.marked(((InvWrapper)(Object)this).getStackInSlot(slot)))ci.setReturnValue(ItemStack.EMPTY);}
 @Inject(method="insertItem",at=@At("HEAD"),cancellable=true)
 private void insert(int slot,ItemStack stack,boolean simulate,CallbackInfoReturnable<ItemStack> ci){if(Starblade.marked(stack))ci.setReturnValue(stack);}
}
