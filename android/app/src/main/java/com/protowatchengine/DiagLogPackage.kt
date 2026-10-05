package com.protowatchengine

import com.facebook.react.ReactPackage
import com.facebook.react.bridge.NativeModule
import com.facebook.react.bridge.ReactApplicationContext
import com.facebook.react.uimanager.ViewManager

/**
 * React Native package that registers [DiagLogModule].
 *
 * Add this class to the `getPackages()` list in your `MainApplication`:
 * ```kotlin
 * override fun getPackages(): List<ReactPackage> =
 *     PackageList(this).packages + listOf(
 *         CellularTelemetryPackage(),
 *         DiagLogPackage(),
 *     )
 * ```
 */
class DiagLogPackage : ReactPackage {

    override fun createNativeModules(
        reactContext: ReactApplicationContext,
    ): List<NativeModule> = listOf(DiagLogModule(reactContext))

    override fun createViewManagers(
        reactContext: ReactApplicationContext,
    ): List<ViewManager<*, *>> = emptyList()
}
