/*
SPDX-FileCopyrightText: 2026 M5Stack Technology CO LTD
SPDX-License-Identifier: MIT
*/

import 'dart:convert';

import 'package:flutter/cupertino.dart';
import 'package:flutter/services.dart';
import 'package:stack_chan/app_state.dart';
import 'package:stack_chan/util/blue_util.dart';

/// Configures the PC-side XiaoZhi bootstrap after normal Wi-Fi provisioning.
///
/// The endpoint and pairing key deliberately stay on the device only; neither
/// value is cached by the mobile app or printed to logs.
class WifiAudioDockConfig extends StatefulWidget {
  const WifiAudioDockConfig({super.key});

  @override
  State<WifiAudioDockConfig> createState() => _WifiAudioDockConfigState();
}

class _WifiAudioDockConfigState extends State<WifiAudioDockConfig> {
  final _endpointController = TextEditingController();
  final _keyController = TextEditingController();
  bool _isSaving = false;

  @override
  void initState() {
    super.initState();
    BlueUtil.shared.wifiSetCharacteristicCall = _onConfigurationNotification;
  }

  @override
  void dispose() {
    BlueUtil.shared.wifiSetCharacteristicCall = null;
    _endpointController.dispose();
    _keyController.dispose();
    super.dispose();
  }

  void _onConfigurationNotification(List<int> value) {
    try {
      final payload = jsonDecode(utf8.decode(value)) as Map<String, dynamic>;
      final state = (payload['data'] as Map<String, dynamic>?)?['state'];
      if (state == 'wifiAudioConfigured' && mounted) {
        setState(() => _isSaving = false);
        AppState.shared.showToast('PC Dock saved to StackChan.');
      } else if (state == 'wifiAudioConfigFailed' && mounted) {
        setState(() => _isSaving = false);
        AppState.shared.showToast('PC Dock configuration was rejected.');
      }
    } catch (_) {
      // Ignore unrelated BLE status notifications.
    }
  }

  Future<void> _save() async {
    final endpoint = _endpointController.text.trim();
    final key = _keyController.text.trim();
    final validEndpoint = endpoint.startsWith('https://') || endpoint.startsWith('http://');
    final validKey = RegExp(r'^[0-9a-fA-F]{64}$').hasMatch(key);
    if (!validEndpoint || !validKey) {
      AppState.shared.showToast('Enter the XiaoZhi bootstrap HTTP endpoint and 64-character pairing key.');
      return;
    }

    setState(() => _isSaving = true);
    final sent = await BlueUtil.shared.sendWifiSetData(jsonEncode({
      'cmd': 'setWifiAudio',
      'data': {'url': endpoint, 'key': key},
    }));
    if (!sent && mounted) {
      setState(() => _isSaving = false);
      AppState.shared.showToast('Bluetooth disconnected. Reconnect and try again.');
    }
  }

  @override
  Widget build(BuildContext context) {
    return CupertinoPageScaffold(
      navigationBar: CupertinoNavigationBar(
        middle: const Text('Wi-Fi Audio Dock'),
        trailing: CupertinoButton(
          padding: EdgeInsets.zero,
          onPressed: _isSaving ? null : _save,
          child: _isSaving
              ? const CupertinoActivityIndicator()
              : const Icon(CupertinoIcons.check_mark),
        ),
      ),
      child: SafeArea(
        child: ListView(
          children: [
            Padding(
              padding: const EdgeInsets.all(20),
              child: Text(
                'Configure the PC XiaoZhi bootstrap after StackChan is connected to the same Wi-Fi. The pairing key is stored only on StackChan.',
                style: TextStyle(color: CupertinoColors.secondaryLabel.resolveFrom(context)),
              ),
            ),
            CupertinoListSection.insetGrouped(
              header: const Text('XiaoZhi bootstrap endpoint'),
              children: [
                CupertinoTextField(
                  controller: _endpointController,
                  placeholder: 'http://192.168.x.x:8764/xiaozhi/ota',
                  keyboardType: TextInputType.url,
                  textInputAction: TextInputAction.next,
                  padding: const EdgeInsets.all(12),
                ),
              ],
            ),
            CupertinoListSection.insetGrouped(
              header: const Text('Pairing key'),
              footer: const Text('Paste the 64-character key printed by the PC Dock.'),
              children: [
                CupertinoTextField(
                  controller: _keyController,
                  placeholder: '64 hexadecimal characters',
                  autocorrect: false,
                  enableSuggestions: false,
                  obscureText: true,
                  inputFormatters: [FilteringTextInputFormatter.allow(RegExp(r'[0-9a-fA-F]'))],
                  padding: const EdgeInsets.all(12),
                  onSubmitted: (_) => _isSaving ? null : _save(),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
