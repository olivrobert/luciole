<?php

declare(strict_types=1);

namespace Mediatheque\Infrastructure\Symfony\Controller\Public\Inscription;

use Mediatheque\Application\Message\Command\Inscription\InscrireMediatheque;
use Mediatheque\Domain\Exception\EmailAlreadyExistsException;
use Mediatheque\Infrastructure\Symfony\Form\Inscription\InscriptionDto;
use Mediatheque\Infrastructure\Symfony\Form\Inscription\InscriptionType;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\Exception\HandlerFailedException;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Contracts\Translation\TranslatorInterface;

#[Route('', name: 'inscription', methods: [Request::METHOD_GET, Request::METHOD_POST])]
final class InscriptionController extends AbstractController
{
    public function __invoke(
        Request $request,
        MessageBusInterface $bus,
        TranslatorInterface $translator,
    ): Response {
        $dto = new InscriptionDto();
        $form = $this->createForm(InscriptionType::class, $dto);
        $form->handleRequest($request);

        if ($form->isSubmitted() && $form->isValid()) {
            $dto->assertValid();

            try {
                $bus->dispatch(new InscrireMediatheque(
                    email: $dto->email,
                    passwordHash: $dto->passwordHash,
                    prenom: $dto->prenom,
                    nom: $dto->nom,
                    telephone: $dto->telephone,
                    raisonSociale: $dto->raisonSociale,
                    adresse: $dto->adresse,
                    ville: $dto->ville,
                    codePostal: $dto->codePostal,
                ));

                return $this->redirectToRoute('public_mediatheque_inscription_confirmation');
            } catch (HandlerFailedException $e) {
                if ($e->getWrappedExceptions(EmailAlreadyExistsException::class)) {
                    $this->addFlash('error', $translator->trans('registration.email_already_registered', domain: 'mediatheque'));

                    return $this->redirectToRoute('public_mediatheque_inscription');
                }

                throw $e;
            }
        }

        return $this->render('public/mediatheque/inscription/inscription.html.twig', [
            'form' => $form,
        ]);
    }
}
