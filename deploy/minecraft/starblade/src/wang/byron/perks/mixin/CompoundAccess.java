package wang.byron.perks.mixin;
import wang.byron.perks.Starblade;
import net.minecraft.world.*;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;
@Mixin(value=CompoundContainer.class,remap=false)
public interface CompoundAccess {
 @Accessor("container1") Container starbladeFirst();
 @Accessor("container2") Container starbladeSecond();
}
