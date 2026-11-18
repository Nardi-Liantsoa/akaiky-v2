package mg.nosytech.akaiky;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Greffon local (pas un paquet npm) : enregistré avant le pont.
        registerPlugin(AkaikyDevicePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
