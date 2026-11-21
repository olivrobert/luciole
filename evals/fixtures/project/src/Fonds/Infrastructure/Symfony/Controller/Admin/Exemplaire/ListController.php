<?php

declare(strict_types=1);

namespace Fonds\Infrastructure\Symfony\Controller\Admin\Exemplaire;

use Fonds\Application\Message\Query\ListExemplaires\ListExemplaires;
use Fonds\Infrastructure\Symfony\Form\Exemplaire\ExemplaireFiltreType;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Messenger\MessageBusInterface;
use Symfony\Component\Messenger\Stamp\HandledStamp;
use Symfony\Component\Routing\Attribute\Route;
use Symfony\Component\Security\Http\Attribute\IsGranted;

#[Route('/exemplaires', name: 'exemplaire_list', methods: [Request::METHOD_GET])]
#[IsGranted('ROLE_ADMIN')]
final class ListController extends AbstractController
{
    public function __construct(
        private readonly MessageBusInterface $queryBus,
    ) {
    }

    public function __invoke(Request $request): Response
    {
        $filtre = $this->createForm(ExemplaireFiltreType::class, null, ['method' => 'GET']);
        $filtre->handleRequest($request);

        $criteres = $filtre->isSubmitted() && $filtre->isValid() ? $filtre->getData() : [];

        $page = $this->queryBus
            ->dispatch(new ListExemplaires($criteres, $request->query->getInt('page', 1)))
            ->last(HandledStamp::class)
            ?->getResult();

        return $this->render('admin/fonds/exemplaire/list.html.twig', [
            'filtre' => $filtre,
            'page' => $page,
        ]);
    }
}
