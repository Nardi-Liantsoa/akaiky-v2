package mg.nosytech.akaiky;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.Plugin;

public class MainActivity extends BridgeActivity {
    @Override
    @SuppressWarnings("unchecked")
    public void onCreate(Bundle savedInstanceState) {
        // Greffons locaux (pas des paquets npm) : enregistrés avant le pont.
        registerPlugin(AkaikyDevicePlugin.class);
        // Appels (NAR-142), mode appareil dédié (NAR-167), signal en arrière-plan (NAR-180), SOS (NAR-151), mise à jour (NAR-170) et position à la demande (NAR-204) : variante enfant seulement
        // (compilés dans android/app/src/enfant, où sont déclarées leurs permissions).
        // L'app parent n'en a pas.
        if ("enfant".equals(BuildConfig.FLAVOR)) {
            for (String name : new String[] { "mg.nosytech.akaiky.CallPlugin", "mg.nosytech.akaiky.KioskPlugin", "mg.nosytech.akaiky.BackgroundStatusPlugin", "mg.nosytech.akaiky.SosPlugin", "mg.nosytech.akaiky.ApkUpdatePlugin", "mg.nosytech.akaiky.LocationPlugin" }) {
                try {
                    registerPlugin((Class<? extends Plugin>) Class.forName(name));
                } catch (ClassNotFoundException e) {
                    throw new IllegalStateException(name + " absent de la variante enfant", e);
                }
            }
        }
        super.onCreate(savedInstanceState);
    }
}
