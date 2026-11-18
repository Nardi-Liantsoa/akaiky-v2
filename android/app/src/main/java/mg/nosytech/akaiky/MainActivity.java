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
        // Appels : variante enfant seulement (CallPlugin n'est compilé que dans
        // android/app/src/enfant, où CALL_PHONE est déclarée). L'app parent n'en a pas.
        if ("enfant".equals(BuildConfig.FLAVOR)) {
            try {
                registerPlugin((Class<? extends Plugin>) Class.forName("mg.nosytech.akaiky.CallPlugin"));
            } catch (ClassNotFoundException e) {
                throw new IllegalStateException("CallPlugin absent de la variante enfant", e);
            }
        }
        super.onCreate(savedInstanceState);
    }
}
