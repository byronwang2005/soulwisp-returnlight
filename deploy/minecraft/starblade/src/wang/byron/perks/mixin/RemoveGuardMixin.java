package wang.byron.perks.mixin;
import wang.byron.perks.Starblade;
import java.util.List;
import net.minecraft.world.ContainerHelper;
import net.minecraft.world.item.ItemStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.*;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;
@Mixin(value=ContainerHelper.class,remap=false)
public abstract class RemoveGuardMixin {
 @Inject(method="removeItem",at=@At("HEAD"),cancellable=true)
 private static void extract(List<ItemStack> items,int slot,int amount,CallbackInfoReturnable<ItemStack> ci){if(slot>=0&&slot<items.size()&&Starblade.marked(items.get(slot))&&!Starblade.automationAllowed(items.get(slot)))ci.setReturnValue(ItemStack.EMPTY);}
}
